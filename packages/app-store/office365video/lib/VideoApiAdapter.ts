import { z } from "zod";

import {
  CalendarAppDelegationCredentialConfigurationError,
  CalendarAppDelegationCredentialInvalidGrantError,
} from "@calcom/lib/CalendarAppError";
import { handleErrorsRaw } from "@calcom/lib/errors";
import { HttpError } from "@calcom/lib/http-error";
import { getTranslation } from "@calcom/lib/server/i18n";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { CredentialForCalendarServiceWithTenantId } from "@calcom/types/Credential";
import type { PartialReference } from "@calcom/types/EventManager";
import type { VideoApiAdapter, VideoCallData } from "@calcom/types/VideoApiAdapter";

import getParsedAppKeysFromSlug from "../../_utils/getParsedAppKeysFromSlug";
import { OAuthManager } from "../../_utils/oauth/OAuthManager";
import { oAuthManagerHelper } from "../../_utils/oauth/oAuthManagerHelper";
import config from "../config.json";

/** @link https://docs.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0&tabs=http#response */
export interface TeamsEventResult {
  creationDateTime: string;
  startDateTime: string;
  endDateTime: string;
  id: string;
  joinWebUrl: string;
  subject: string;
}

const o365VideoAppKeysSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
});

const getO365VideoAppKeys = async () => {
  return getParsedAppKeysFromSlug(config.slug, o365VideoAppKeysSchema);
};

const TeamsVideoApiAdapter = (credential: CredentialForCalendarServiceWithTenantId): VideoApiAdapter => {
  console.log("TeamsVideoApiAdapter--credential: ", credential);
  let azureUserId: string | null;
  const tokenResponse = oAuthManagerHelper.getTokenObjectFromCredential(credential);

  const auth = new OAuthManager({
    credentialSyncVariables: oAuthManagerHelper.credentialSyncVariables,
    resourceOwner: {
      type: "user",
      id: credential.userId,
    },
    appSlug: config.slug,
    currentTokenObject: tokenResponse,
    fetchNewTokenObject: async ({ refreshToken }: { refreshToken: string | null }) => {
      const isDelegated = Boolean(credential?.delegatedTo);
      if (!isDelegated && !refreshToken) {
        return null;
      }

      const credentials = isDelegated
        ? {
            client_id: credential?.delegatedTo?.serviceAccountKey?.client_id,
            client_secret: credential?.delegatedTo?.serviceAccountKey?.private_key,
          }
        : await getO365VideoAppKeys();

      if (isDelegated && (!credentials.client_id || !credentials.client_secret)) {
        throw new CalendarAppDelegationCredentialConfigurationError(
          "Delegation credential without clientId or Secret"
        );
      }

      const url = getAuthUrl(isDelegated, credential?.delegatedTo?.serviceAccountKey?.tenant_id);
      const scope = isDelegated
        ? "https://graph.microsoft.com/.default"
        : "User.Read Calendars.Read Calendars.ReadWrite";

      const params: Record<string, string> = {
        scope,
        client_id: credentials.client_id || "",
        client_secret: credentials.client_secret || "",
        grant_type: isDelegated ? "client_credentials" : "refresh_token",
        ...(isDelegated ? {} : { refresh_token: refreshToken ?? "" }),
      };

      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
    },
    isTokenObjectUnusable: async function (response) {
      const myLog = console.log;
      try {
        const clonedResponse = response.clone();
        const responseBody = await clonedResponse.json();
        myLog("isTokenObjectUnusable response:", responseBody);

        if (
          responseBody.error === "invalid_grant" ||
          (responseBody.error_codes &&
            (responseBody.error_codes.includes(9002313) || responseBody.error_codes.includes(70000)))
        ) {
          return {
            reason: responseBody.error || "Microsoft authentication error",
          };
        }
      } catch (error) {
        myLog("Error parsing response in isTokenObjectUnusable:", error);
      }
      return null;
    },
    isAccessTokenUnusable: async function (response) {
      const myLog = console.log;
      try {
        const clonedResponse = response.clone();
        const responseBody = await clonedResponse.json();
        myLog("isAccessTokenUnusable response:", responseBody);

        if (
          responseBody.error === "invalid_token" ||
          (responseBody.error_codes && responseBody.error_codes.includes(70000))
        ) {
          return {
            reason: responseBody.error || "Microsoft access token error",
          };
        }
      } catch (error) {
        myLog("Error parsing response in isAccessTokenUnusable:", error);
      }
      return null;
    },
    invalidateTokenObject: () => oAuthManagerHelper.invalidateCredential(credential.id),
    expireAccessToken: () => oAuthManagerHelper.markTokenAsExpired(credential),
    updateTokenObject: (tokenObject) => {
      if (!Boolean(credential.delegatedTo)) {
        return oAuthManagerHelper.updateTokenObject({ tokenObject, credentialId: credential.id });
      }
      return Promise.resolve();
    },
  });

  function getAuthUrl(delegatedTo: boolean, tenantId?: string): string {
    if (delegatedTo) {
      if (!tenantId) {
        throw new CalendarAppDelegationCredentialInvalidGrantError(
          "Invalid DelegationCredential Settings: tenantId is missing"
        );
      }
      return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    }

    return "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  }

  const translateEvent = (event: CalendarEvent) => {
    return {
      startDateTime: event.startTime,
      endDateTime: event.endTime,
      subject: event.title,
    };
  };

  async function getAzureUserId(credential: CredentialForCalendarServiceWithTenantId) {
    if (azureUserId) return azureUserId;

    const isDelegated = Boolean(credential?.delegatedTo);

    if (!isDelegated) return null;

    const url = getAuthUrl(isDelegated, credential?.delegatedTo?.serviceAccountKey?.tenant_id);

    const delegationCredentialClientId = credential.delegatedTo?.serviceAccountKey?.client_id;
    const delegationCredentialClientSecret = credential.delegatedTo?.serviceAccountKey?.private_key;

    if (!delegationCredentialClientId || !delegationCredentialClientSecret) {
      throw new CalendarAppDelegationCredentialConfigurationError(
        "Delegation credential without clientId or Secret"
      );
    }
    const loginResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        scope: "https://graph.microsoft.com/.default",
        client_id: delegationCredentialClientId,
        grant_type: "client_credentials",
        client_secret: delegationCredentialClientSecret,
      }),
    });

    const clonedResponse = loginResponse.clone();
    const parsedLoginResponse = await clonedResponse.json();
    const token = parsedLoginResponse?.access_token;
    const oauthClientIdAliasRegex = /\+[a-zA-Z0-9]{25}/;
    const email = credential?.user?.email.replace(oauthClientIdAliasRegex, "");
    const encodedFilter = encodeURIComponent(`mail eq '${email}'`);
    const queryParams = `$filter=${encodedFilter}`;

    const response = await fetch(`https://graph.microsoft.com/v1.0/users?${queryParams}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
    });

    const parsedBody = await response.json();

    if (!parsedBody?.value?.[0]?.id) {
      throw new CalendarAppDelegationCredentialInvalidGrantError(
        "User might not exist in Microsoft Azure Active Directory"
      );
    }
    azureUserId = parsedBody.value[0].id;
    return azureUserId;
  }

  async function getUserEndpoint(): Promise<string> {
    const azureUserId = await getAzureUserId(credential);
    return azureUserId
      ? `https://graph.microsoft.com/v1.0/users/${azureUserId}`
      : "https://graph.microsoft.com/v1.0/me";
  }

  // Since the meeting link is not tied to an event we only need the create and update functions
  return {
    getAvailability: () => {
      return Promise.resolve([]);
    },
    updateMeeting: async (bookingRef: PartialReference, event: CalendarEvent) => {
      try {
        const resultString = await auth
          .requestRaw({
            url: `${await getUserEndpoint()}/onlineMeetings`,
            options: {
              method: "POST",
              body: JSON.stringify(translateEvent(event)),
            },
          })
          .then(handleErrorsRaw);

        const resultObject = JSON.parse(resultString);

        return {
          type: "office365_video",
          id: resultObject.id,
          password: "",
          url: resultObject.joinWebUrl || resultObject.joinUrl,
        };
      } catch (error) {
        console.error("[ERROR] MS Teams updateMeeting failed:", error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("Invalid token") ||
          errorMessage.includes("invalid_grant") ||
          errorMessage.includes("Microsoft authentication error")
        ) {
          await oAuthManagerHelper.invalidateCredential(credential.id);

          const t = await getTranslation("en", "common");
          throw new Error(t("ms_teams_authentication_failed"));
        }

        throw error;
      }
    },
    deleteMeeting: () => {
      return Promise.resolve([]);
    },
    createMeeting: async (event: CalendarEvent): Promise<VideoCallData> => {
      const MAX_RETRY_ATTEMPTS = 2;
      let retryCount = 0;

      async function attemptCreateMeeting() {
        try {
          const url = `${await getUserEndpoint()}/onlineMeetings`;
          const resultString = await auth
            .requestRaw({
              url,
              options: {
                method: "POST",
                body: JSON.stringify(translateEvent(event)),
              },
            })
            .then(handleErrorsRaw);

          const resultObject = JSON.parse(resultString);

          if (!resultObject.id || !resultObject.joinUrl || !resultObject.joinWebUrl) {
            throw new HttpError({
              statusCode: 500,
              message: `Error creating MS Teams meeting: ${resultObject.error?.message || "Unknown error"}`,
            });
          }

          return {
            type: "office365_video",
            id: resultObject.id,
            password: "",
            url: resultObject.joinWebUrl || resultObject.joinUrl,
          };
        } catch (error) {
          console.error(`[ERROR] MS Teams createMeeting attempt ${retryCount + 1} failed:`, error);

          const errorMessage = error instanceof Error ? error.message : String(error);
          const isAuthError =
            errorMessage.includes("Invalid token") ||
            errorMessage.includes("invalid_grant") ||
            errorMessage.includes("Microsoft authentication error") ||
            errorMessage.includes("access token expired");

          if (isAuthError && retryCount < MAX_RETRY_ATTEMPTS) {
            retryCount++;
            console.log(
              `Retrying MS Teams meeting creation (attempt ${retryCount} of ${MAX_RETRY_ATTEMPTS})...`
            );

            await new Promise((resolve) => setTimeout(resolve, 1000));
            return attemptCreateMeeting();
          }

          if (isAuthError) {
            await oAuthManagerHelper.invalidateCredential(credential.id);

            const t = await getTranslation("en", "common");
            throw new Error(
              `${t("ms_teams_connection_error")} ${t("ms_teams_connection_error_fallback")} ${t(
                "ms_teams_connection_error_instruction"
              )}`
            );
          }

          throw error;
        }
      }

      return attemptCreateMeeting();
    },
  };
};

export default TeamsVideoApiAdapter;
