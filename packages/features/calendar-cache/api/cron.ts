import type { NextApiRequest } from "next";

import { HttpError } from "@calcom/lib/http-error";
import { defaultHandler } from "@calcom/lib/server/defaultHandler";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import { SelectedCalendarRepository } from "@calcom/lib/server/repository/selectedCalendar";
import type { SelectedCalendarEventTypeIds } from "@calcom/types/Calendar";

import { CalendarCache } from "../calendar-cache";

const validateRequest = (req: NextApiRequest) => {
  const apiKey = req.headers.authorization || req.query.apiKey;
  if ([process.env.CRON_API_KEY, `Bearer ${process.env.CRON_SECRET}`].includes(`${apiKey}`)) {
    return;
  }
  throw new HttpError({ statusCode: 401, message: "Unauthorized" });
};

function logRejected(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") {
    console.error(result.reason);
  }
}

function getUniqueCalendarsByExternalId<
  T extends { externalId: string; eventTypeId: number | null; credentialId: number | null; id: string }
>(calendars: T[]) {
  type ExternalId = string;
  return calendars.reduce(
    (acc, sc) => {
      if (!acc[sc.externalId]) {
        acc[sc.externalId] = {
          eventTypeIds: [sc.eventTypeId],
          credentialId: sc.credentialId,
          id: sc.id,
        };
      } else {
        acc[sc.externalId].eventTypeIds.push(sc.eventTypeId);
      }
      return acc;
    },
    {} as Record<
      ExternalId,
      {
        eventTypeIds: SelectedCalendarEventTypeIds;
        credentialId: number | null;
        id: string;
      }
    >
  );
}

async function handleCalendarOperation(
  operation: "watch" | "unwatch",
  getBatch: () => Promise<
    Array<{ externalId: string; eventTypeId: number | null; credentialId: number | null; id: string }>
  >
) {
  const calendars = await getBatch();
  const calendarsWithEventTypeIdsGroupedTogether = getUniqueCalendarsByExternalId(calendars);

  const result = await Promise.allSettled(
    Object.entries(calendarsWithEventTypeIdsGroupedTogether).map(
      async ([externalId, { eventTypeIds, credentialId, id }]) => {
        if (!credentialId) {
          await SelectedCalendarRepository.updateById(id, { error: "Missing credentialId" });
          console.log("no credentialId for SelectedCalendar: ", id);
          return;
        }

        const cc = await CalendarCache.initFromCredentialId(credentialId);
        try {
          if (operation === "watch") {
            await cc.watchCalendar({ calendarId: externalId, eventTypeIds });
          } else {
            await cc.unwatchCalendar({ calendarId: externalId, eventTypeIds });
          }
        } catch (error) {
          console.error(error);
          await SelectedCalendarRepository.updateById(id, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    )
  );

  result.forEach(logRejected);
  return result;
}

// This cron is used to activate and renew calendar subscriptions
const handler = defaultResponder(async (request: NextApiRequest) => {
  validateRequest(request);

  await Promise.allSettled([
    handleCalendarOperation("watch", SelectedCalendarRepository.getNextBatchToWatch),
    handleCalendarOperation("unwatch", SelectedCalendarRepository.getNextBatchToUnwatch),
  ]);

  // TODO: Credentials can be installed on a whole team, check for selected calendars on the team
  return {
    executedAt: new Date().toISOString(),
  };
});

export default defaultHandler({
  GET: Promise.resolve({ default: defaultResponder(handler) }),
});
