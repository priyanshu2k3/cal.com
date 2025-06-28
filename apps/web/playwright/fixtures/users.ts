import type { Browser, Page, WorkerInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import type Prisma from "@prisma/client";
import type { Team } from "@prisma/client";
import { Prisma as PrismaType } from "@prisma/client";
import { hashSync as hash } from "bcryptjs";
import { uuid } from "short-uuid";
import { v4 } from "uuid";

import updateChildrenEventTypes from "@calcom/features/ee/managed-event-types/lib/handleChildrenEventTypes";
import stripe from "@calcom/features/ee/payments/server/stripe";
import { DEFAULT_SCHEDULE, getAvailabilityFromSchedule } from "@calcom/lib/availability";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { ProfileRepository } from "@calcom/lib/server/repository/profile";
import { prisma } from "@calcom/prisma";
import { MembershipRole, SchedulingType, TimeUnit, WorkflowTriggerEvents } from "@calcom/prisma/enums";
import { teamMetadataSchema } from "@calcom/prisma/zod-utils";
import type { Schedule } from "@calcom/types/schedule";

import { selectFirstAvailableTimeSlotNextMonth, teamEventSlug, teamEventTitle } from "../lib/testUtils";
import type { createEmailsFixture } from "./emails";
import { TimeZoneEnum } from "./types";

// Don't import hashPassword from app as that ends up importing next-auth and initializing it before NEXTAUTH_URL can be updated during tests.
export function hashPassword(password: string) {
  const hashedPassword = hash(password, 12);
  return hashedPassword;
}

type UserFixture = ReturnType<typeof createUserFixture>;

export type CreateUsersFixture = ReturnType<typeof createUsersFixture>;

const userIncludes = PrismaType.validator<PrismaType.UserInclude>()({
  eventTypes: true,
  workflows: true,
  credentials: true,
  routingForms: true,
});

type InstallStripeParamsSkipTrue = {
  eventTypeIds?: number[];
  skip: true;
};

type InstallStripeParamsSkipFalse = {
  skip: false;
  eventTypeIds: number[];
};
type InstallStripeParamsUnion = InstallStripeParamsSkipTrue | InstallStripeParamsSkipFalse;
type InstallStripeTeamPramas = InstallStripeParamsUnion & {
  page: Page;
  teamId: number;
};
type InstallStripePersonalPramas = InstallStripeParamsUnion & {
  page: Page;
};

type InstallStripeParams = InstallStripeParamsUnion & {
  redirectUrl: string;
  buttonSelector: string;
  page: Page;
};

const userWithEventTypes = PrismaType.validator<PrismaType.UserArgs>()({
  include: userIncludes,
});

const seededForm = {
  id: "948ae412-d995-4865-875a-48302588de03",
  name: "Seeded Form - Pro",
};

type UserWithIncludes = PrismaType.UserGetPayload<typeof userWithEventTypes>;

const createTeamWorkflow = async (user: { id: number }, team: { id: number }) => {
  return await prisma.workflow.create({
    data: {
      name: "Team Workflow",
      trigger: WorkflowTriggerEvents.BEFORE_EVENT,
      time: 24,
      timeUnit: TimeUnit.HOUR,
      userId: user.id,
      teamId: team.id,
    },
  });
};

export const createTeamEventType = async (
  user: { id: number },
  team: { id: number },
  scenario?: {
    schedulingType?: SchedulingType;
    teamEventTitle?: string;
    teamEventSlug?: string;
    teamEventLength?: number;
    seatsPerTimeSlot?: number;
    managedEventUnlockedFields?: Record<string, boolean>;
    assignAllTeamMembers?: boolean;
  }
) => {
  return await prisma.eventType.create({
    data: {
      team: {
        connect: {
          id: team.id,
        },
      },
      users: {
        connect: {
          id: user.id,
        },
      },
      owner: {
        connect: {
          id: user.id,
        },
      },
      hosts: {
        create: {
          userId: user.id,
          isFixed: scenario?.schedulingType === SchedulingType.COLLECTIVE ? true : false,
        },
      },
      schedulingType: scenario?.schedulingType ?? SchedulingType.COLLECTIVE,
      title: scenario?.teamEventTitle ?? `${teamEventTitle}-team-id-${team.id}`,
      slug: scenario?.teamEventSlug ?? `${teamEventSlug}-team-id-${team.id}`,
      length: scenario?.teamEventLength ?? 30,
      seatsPerTimeSlot: scenario?.seatsPerTimeSlot,
      locations: [{ type: "integrations:daily" }],
      metadata:
        scenario?.schedulingType === SchedulingType.MANAGED
          ? {
              managedEventConfig: {
                unlockedFields: {
                  locations: true,
                  scheduleId: true,
                  destinationCalendar: true,
                  ...scenario?.managedEventUnlockedFields,
                },
              },
            }
          : undefined,
      assignAllTeamMembers: scenario?.assignAllTeamMembers,
    },
  });
};

const createTeamAndAddUser = async (
  {
    user,
    isUnpublished,
    isOrg,
    isOrgVerified,
    hasSubteam,
    organizationId,
    isDnsSetup,
    index,
    orgRequestedSlug,
    schedulingType,
    assignAllTeamMembersForSubTeamEvents,
  }: {
    user: { id: number; email: string; username: string | null; role?: MembershipRole };
    isUnpublished?: boolean;
    isOrg?: boolean;
    isOrgVerified?: boolean;
    isDnsSetup?: boolean;
    hasSubteam?: true;
    organizationId?: number | null;
    index?: number;
    orgRequestedSlug?: string;
    schedulingType?: SchedulingType;
    assignAllTeamMembersForSubTeamEvents?: boolean;
  },
  workerInfo: WorkerInfo
) => {
  const slugIndex = index ? `-count-${index}` : "";
  const slug =
    orgRequestedSlug ?? `${isOrg ? "org" : "team"}-${workerInfo.workerIndex}-${Date.now()}${slugIndex}`;
  const data: PrismaType.TeamCreateInput = {
    name: `user-id-${user.id}'s ${isOrg ? "Org" : "Team"}`,
    isOrganization: isOrg,
  };
  data.metadata = {
    ...(isUnpublished ? { requestedSlug: slug } : {}),
  };
  if (isOrg) {
    data.organizationSettings = {
      create: {
        orgAutoAcceptEmail: user.email.split("@")[1],
        isOrganizationVerified: !!isOrgVerified,
        isOrganizationConfigured: isDnsSetup,
      },
    };
  }

  data.slug = !isUnpublished ? slug : undefined;
  if (isOrg && hasSubteam) {
    const team = await createTeamAndAddUser({ user }, workerInfo);
    await createTeamEventType(user, team, {
      schedulingType: schedulingType,
      assignAllTeamMembers: assignAllTeamMembersForSubTeamEvents,
    });
    await createTeamWorkflow(user, team);
    data.children = { connect: [{ id: team.id }] };
  }
  data.orgProfiles = isOrg
    ? {
        create: [
          {
            uid: ProfileRepository.generateProfileUid(),
            username: user.username ?? user.email.split("@")[0],
            user: {
              connect: {
                id: user.id,
              },
            },
          },
        ],
      }
    : undefined;
  data.parent = organizationId ? { connect: { id: organizationId } } : undefined;
  const team = await prisma.team.create({
    data,
  });

  const { role = MembershipRole.OWNER, id: userId } = user;
  await prisma.membership.create({
    data: {
      createdAt: new Date(),
      teamId: team.id,
      userId,
      role: role,
      accepted: true,
    },
  });

  return team;
};

async function seedAttributes(orgId: number) {
  console.log(`🎯 Seeding attributes for org ${orgId}`);
  const mockAttributes = [
    {
      name: "Department",
      type: "SINGLE_SELECT",
      options: ["Engineering", "Sales", "Marketing", "Product", "Design"],
    },
    {
      name: "Location",
      type: "SINGLE_SELECT",
      options: ["New York", "London", "Tokyo", "Berlin", "Remote"],
    },
    {
      name: "Skills",
      type: "MULTI_SELECT",
      options: ["JavaScript", "React", "Node.js", "Python", "Design", "Sales"],
    },
    {
      name: "Years of Experience",
      type: "NUMBER",
    },
    {
      name: "Bio",
      type: "TEXT",
    },
  ];
  // Check if attributes already exist
  const existingAttributes = await prisma.attribute.findMany({
    where: {
      teamId: orgId,
      name: {
        in: mockAttributes.map((attr) => attr.name),
      },
    },
  });

  if (existingAttributes.length > 0) {
    console.log(`Skipping attributes seed, attributes already exist`);
    return;
  }

  const memberships = await prisma.membership.findMany({
    where: {
      teamId: orgId,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  console.log(`🎯 Creating attributes for org ${orgId}`);

  const attributeRaw: { id: string; options: { id: string; value: string }[] }[] = [];

  for (const attr of mockAttributes) {
    const attribute = await prisma.attribute.create({
      data: {
        name: attr.name,
        slug: `org:${orgId}-${attr.name.toLowerCase().replace(/ /g, "-")}`,
        type: attr.type as "TEXT" | "NUMBER" | "SINGLE_SELECT" | "MULTI_SELECT",
        teamId: orgId,
        enabled: true,
        options: attr.options
          ? {
              create: attr.options.map((opt) => ({
                value: opt,
                slug: opt.toLowerCase().replace(/ /g, "-"),
              })),
            }
          : undefined,
      },
      include: {
        options: true,
      },
    });

    attributeRaw.push({
      id: attribute.id,
      options: attribute.options.map((opt) => ({
        id: opt.id,
        value: opt.value,
      })),
    });

    console.log(`\t📝 Created attribute: ${attr.name}`);

    // Assign random values/options to members
    for (const member of memberships) {
      if (attr.type === "TEXT") {
        const mockText = `Sample ${attr.name.toLowerCase()} text for user ${member.userId}`;
        await prisma.attributeOption.create({
          data: {
            value: mockText,
            slug: mockText.toLowerCase().replace(/ /g, "-"),
            attribute: {
              connect: {
                id: attribute.id,
              },
            },
            assignedUsers: {
              create: {
                memberId: member.id,
              },
            },
          },
        });
      } else if (attr.type === "NUMBER") {
        const mockNumber = Math.floor(Math.random() * 10 + 1).toString();
        await prisma.attributeOption.create({
          data: {
            value: mockNumber,
            slug: mockNumber,
            attribute: {
              connect: {
                id: attribute.id,
              },
            },
            assignedUsers: {
              create: {
                memberId: member.id,
              },
            },
          },
        });
      } else if (attr.type === "SINGLE_SELECT" && attribute.options.length > 0) {
        const randomOption = attribute.options[Math.floor(Math.random() * attribute.options.length)];
        await prisma.attributeToUser.create({
          data: {
            memberId: member.id,
            attributeOptionId: randomOption.id,
          },
        });
      } else if (attr.type === "MULTI_SELECT" && attribute.options.length > 0) {
        // Assign 1-3 random options
        const numOptions = Math.floor(Math.random() * 3) + 1;
        const shuffledOptions = [...attribute.options].sort(() => Math.random() - 0.5);
        const selectedOptions = shuffledOptions.slice(0, numOptions);

        for (const option of selectedOptions) {
          await prisma.attributeToUser.create({
            data: {
              memberId: member.id,
              attributeOptionId: option.id,
            },
          });
        }
      }
    }

    console.log(`\t✅ Assigned ${attr.name} values to ${memberships.length} members`);
  }
  return attributeRaw;
}

const createRoutingForm = async ({
  userId,
  teamId,
  scenario,
}: {
  userId: number;
  teamId: number;
  scenario: {
    seedRoutingForms?: boolean;
    seedRoutingFormWithAttributeRouting?: boolean;
  };
}) => {
  if (scenario.seedRoutingFormWithAttributeRouting) {
    const orgMembership = await prisma.membership.findFirstOrThrow({
      where: {
        userId,
        team: {
          isOrganization: true,
        },
      },
    });
    if (!orgMembership) {
      throw new Error("Organization membership not found");
    }
    const orgId = orgMembership.teamId;
    const team = await prisma.team.findUniqueOrThrow({
      where: {
        id: teamId,
      },
    });

    const salesTeamEvent = await prisma.eventType.create({
      data: {
        title: "Team Sales",
        slug: "team-sales",
        teamId,
        schedulingType: "ROUND_ROBIN",
        assignAllTeamMembers: true,
        length: 60,
        description: "Team Sales",
      },
    });

    const javascriptTeamEvent = await prisma.eventType.create({
      data: {
        title: "Team Javascript",
        slug: "team-javascript",
        description: "Team Javascript",
        teamId,
        schedulingType: "ROUND_ROBIN",
        assignAllTeamMembers: true,
        length: 60,
      },
    });
    // Then seed routing forms
    const attributes = await seedAttributes(orgId);
    if (!attributes) {
      throw new Error("Attributes not found");
    }
    const form = {
      name: "Form with Attribute Routing",
      routes: [
        {
          id: "8a898988-89ab-4cde-b012-31823f708642",
          value: `team/${team.slug}/team-javascript`,
        },
        {
          id: "8b2224b2-89ab-4cde-b012-31823f708642",
          value: `team/${team.slug}/team-sales`,
        },
      ],
      formFieldLocation: {
        id: "674c169a-e40a-492c-b4bb-6f5213873bd6",
      },
      formFieldSkills: {
        id: "83316968-45bf-4c9d-b5d4-5368a8d2d2a8",
      },
      formFieldEmail: {
        id: "dd28ffcf-7029-401e-bddb-ce2e7496a1c1",
      },
      formFieldManager: {
        id: "57734f65-8bbb-4065-9e71-fb7f0b7485f8",
      },
      formFieldRating: {
        id: "f4e9fa6c-5c5d-4d8e-b15c-7f37e9d0c729",
      },
    };

    // Mock attribute data for testing
    const attributeRaw = [
      {
        id: "attr1",
        options: [
          { id: "opt1", value: "Location1" },
          { id: "opt2", value: "Location2" },
        ],
      },
      {
        id: "attr2",
        options: [
          { id: "opt3", value: "Location1" },
          { id: "opt4", value: "Location2" },
        ],
      },
      {
        id: "attr3",
        options: [
          { id: "opt5", value: "JavaScript" },
          { id: "opt6", value: "Sales" },
        ],
      },
    ];

    const formFieldSkillsOptions = attributeRaw[2].options.map((opt) => ({
      id: opt.id,
      label: opt.value,
    }));

    const formFieldLocationOptions = attributeRaw[1].options.map((opt) => ({
      id: opt.id,
      label: opt.value,
    }));

    const createdForm = await prisma.app_RoutingForms_Form.create({
      data: {
        id: uuid(),
        routes: [
          {
            id: form.routes[0].id,
            action: {
              type: "eventTypeRedirectUrl",
              value: form.routes[0].value,
            },
            queryValue: {
              id: "aaba9988-cdef-4012-b456-719300f53ef8",
              type: "group",
              children1: {
                "b98b98a8-0123-4456-b89a-b19300f55277": {
                  type: "rule",
                  properties: {
                    field: form.formFieldSkills.id,
                    value: [
                      formFieldSkillsOptions.filter((opt) => opt.label === "JavaScript").map((opt) => opt.id),
                    ],
                    operator: "multiselect_equals",
                    valueSrc: ["value"],
                    valueType: ["multiselect"],
                    valueError: [null],
                  },
                },
              },
            },
            attributesQueryValue: {
              id: "ab99bbb9-89ab-4cde-b012-319300f53ef8",
              type: "group",
              children1: {
                "b98b98a8-0123-4456-b89a-b19300f55277": {
                  type: "rule",
                  properties: {
                    field: attributeRaw[2].id,
                    value: [
                      attributeRaw[2].options
                        .filter((opt) => opt.value === "JavaScript")
                        .map((opt) => opt.id),
                    ],
                    operator: "multiselect_some_in",
                    valueSrc: ["value"],
                    valueType: ["multiselect"],
                    valueError: [null],
                  },
                },
              },
            },
          },
          {
            id: form.routes[1].id,
            action: {
              type: "eventTypeRedirectUrl",
              value: form.routes[1].value,
            },
            queryValue: {
              id: "aaba9948-cdef-4012-b456-719300f53ef8",
              type: "group",
              children1: {
                "c98b98a8-1123-4456-e89a-a19300f55277": {
                  type: "rule",
                  properties: {
                    field: form.formFieldSkills.id,
                    value: [
                      formFieldSkillsOptions.filter((opt) => opt.label === "Sales").map((opt) => opt.id),
                    ],
                    operator: "multiselect_equals",
                    valueSrc: ["value"],
                    valueType: ["multiselect"],
                    valueError: [null],
                  },
                },
              },
            },
            attributesQueryValue: {
              id: "ab988888-89ab-4cde-b012-319300f53ef8",
              type: "group",
              children1: {
                "b98b98a12-0123-4456-b89a-b19300f55277": {
                  type: "rule",
                  properties: {
                    field: attributeRaw[2].id,
                    value: [
                      attributeRaw[2].options.filter((opt) => opt.value === "Sales").map((opt) => opt.id),
                    ],
                    operator: "multiselect_some_in",
                    valueSrc: ["value"],
                    valueType: ["multiselect"],
                    valueError: [null],
                  },
                },
              },
            },
            fallbackAttributesQueryValue: {
              id: "a9888488-4567-489a-bcde-f19300f53ef8",
              type: "group",
            },
          },
          {
            id: "148899aa-4567-489a-bcde-f1823f708646",
            action: { type: "customPageMessage", value: "Fallback Message" },
            isFallback: true,
            queryValue: { id: "814899aa-4567-489a-bcde-f1823f708646", type: "group" },
          },
        ],
        fields: [
          {
            id: form.formFieldLocation.id,
            type: "select",
            label: "Location",
            options: formFieldLocationOptions,
            required: true,
          },
          {
            id: form.formFieldSkills.id,
            type: "multiselect",
            label: "skills",
            options: formFieldSkillsOptions,
            required: true,
          },
          {
            id: form.formFieldEmail.id,
            type: "email",
            label: "Email",
            required: true,
          },
          {
            id: form.formFieldManager.id,
            type: "text",
            label: "Manager",
            required: false,
          },
          {
            id: form.formFieldRating.id,
            type: "number",
            label: "Rating",
            required: false,
          },
        ],
        team: {
          connect: {
            id: teamId,
          },
        },
        user: {
          connect: {
            id: userId,
          },
        },
        name: form.name,
      },
    });
    console.log(`🎯 Created form ${createdForm.id}`, JSON.stringify(createdForm, null, 2));
  } else {
    // Default branch: Original routing form logic
    const multiSelectOption2Uuid = "d1302635-9f12-17b1-9153-c3a854649182";
    const multiSelectOption1Uuid = "d1292635-9f12-17b1-9153-c3a854649182";
    const selectOption1Uuid = "d0292635-9f12-17b1-9153-c3a854649182";
    const selectOption2Uuid = "d0302635-9f12-17b1-9153-c3a854649182";
    const multiSelectLegacyFieldUuid = "d4292635-9f12-17b1-9153-c3a854649182";
    const multiSelectFieldUuid = "d9892635-9f12-17b1-9153-c3a854649182";
    const selectFieldUuid = "d1302635-9f12-17b1-9153-c3a854649182";
    const legacySelectFieldUuid = "f0292635-9f12-17b1-9153-c3a854649182";
    await prisma.app_RoutingForms_Form.create({
      data: {
        routes: [
          {
            id: "8a898988-89ab-4cde-b012-31823f708642",
            action: { type: "eventTypeRedirectUrl", value: "pro/30min" },
            queryValue: {
              id: "8a898988-89ab-4cde-b012-31823f708642",
              type: "group",
              children1: {
                "8988bbb8-0123-4456-b89a-b1823f70c5ff": {
                  type: "rule",
                  properties: {
                    field: "c4296635-9f12-47b1-8153-c3a854649182",
                    value: ["event-routing"],
                    operator: "equal",
                    valueSrc: ["value"],
                    valueType: ["text"],
                  },
                },
              },
            },
          },
          {
            id: "aa8aaba9-cdef-4012-b456-71823f70f7ef",
            action: { type: "customPageMessage", value: "Custom Page Result" },
            queryValue: {
              id: "aa8aaba9-cdef-4012-b456-71823f70f7ef",
              type: "group",
              children1: {
                "b99b8a89-89ab-4cde-b012-31823f718ff5": {
                  type: "rule",
                  properties: {
                    field: "c4296635-9f12-47b1-8153-c3a854649182",
                    value: ["custom-page"],
                    operator: "equal",
                    valueSrc: ["value"],
                    valueType: ["text"],
                  },
                },
              },
            },
          },
          {
            id: "a8ba9aab-4567-489a-bcde-f1823f71b4ad",
            action: { type: "externalRedirectUrl", value: `${WEBAPP_URL}/pro` },
            queryValue: {
              id: "a8ba9aab-4567-489a-bcde-f1823f71b4ad",
              type: "group",
              children1: {
                "998b9b9a-0123-4456-b89a-b1823f7232b9": {
                  type: "rule",
                  properties: {
                    field: "c4296635-9f12-47b1-8153-c3a854649182",
                    value: ["external-redirect"],
                    operator: "equal",
                    valueSrc: ["value"],
                    valueType: ["text"],
                  },
                },
              },
            },
          },
          {
            id: "aa8ba8b9-0123-4456-b89a-b182623406d8",
            action: { type: "customPageMessage", value: "Multiselect(Legacy) chosen" },
            queryValue: {
              id: "aa8ba8b9-0123-4456-b89a-b182623406d8",
              type: "group",
              children1: {
                "b98a8abb-cdef-4012-b456-718262343d27": {
                  type: "rule",
                  properties: {
                    field: multiSelectLegacyFieldUuid,
                    value: [["Option-2"]],
                    operator: "multiselect_equals",
                    valueSrc: ["value"],
                    valueType: ["multiselect"],
                  },
                },
              },
            },
          },
          {
            id: "bb9ea8b9-0123-4456-b89a-b182623406d8",
            action: { type: "customPageMessage", value: "Multiselect chosen" },
            queryValue: {
              id: "aa8ba8b9-0123-4456-b89a-b182623406d8",
              type: "group",
              children1: {
                "b98a8abb-cdef-4012-b456-718262343d27": {
                  type: "rule",
                  properties: {
                    field: multiSelectFieldUuid,
                    value: [[multiSelectOption2Uuid]],
                    operator: "multiselect_equals",
                    valueSrc: ["value"],
                    valueType: ["multiselect"],
                  },
                },
              },
            },
          },
          {
            id: "898899aa-4567-489a-bcde-f1823f708646",
            action: { type: "customPageMessage", value: "Fallback Message" },
            isFallback: true,
            queryValue: { id: "898899aa-4567-489a-bcde-f1823f708646", type: "group" },
          },
        ],
        fields: [
          {
            id: "c4296635-9f12-47b1-8153-c3a854649182",
            type: "text",
            label: "Test field",
            required: true,
          },
          {
            id: multiSelectLegacyFieldUuid,
            type: "multiselect",
            label: "Multi Select(with Legacy `selectText`)",
            identifier: "multi",
            selectText: "Option-1\nOption-2",
            required: false,
          },
          {
            id: multiSelectFieldUuid,
            type: "multiselect",
            label: "Multi Select",
            identifier: "multi-new-format",
            options: [
              {
                id: multiSelectOption1Uuid,
                label: "Option-1",
              },
              {
                id: multiSelectOption2Uuid,
                label: "Option-2",
              },
            ],
            required: false,
          },
          {
            id: legacySelectFieldUuid,
            type: "select",
            label: "Legacy Select",
            identifier: "test-select",
            selectText: "Option-1\nOption-2",
            required: false,
          },
          {
            id: selectFieldUuid,
            type: "select",
            label: "Select",
            identifier: "test-select-new-format",
            options: [
              {
                id: selectOption1Uuid,
                label: "Option-1",
              },
              {
                id: selectOption2Uuid,
                label: "Option-2",
              },
            ],
            required: false,
          },
        ],
        user: {
          connect: {
            id: userId,
          },
        },
        name: seededForm.name,
      },
    });
  }
};

// creates a user fixture instance and stores the collection
export const createUsersFixture = (
  page: Page,
  emails: ReturnType<typeof createEmailsFixture>,
  workerInfo: WorkerInfo
) => {
  const store = { users: [], trackedEmails: [], page, teams: [] } as {
    users: UserFixture[];
    trackedEmails: { email: string }[];
    page: Page;
    teams: Team[];
  };
  return {
    buildForSignup: (opts?: Pick<CustomUserOpts, "email" | "username" | "useExactUsername" | "password">) => {
      const uname =
        opts?.useExactUsername && opts?.username
          ? opts.username
          : `${opts?.username || "user"}-${workerInfo.workerIndex}-${Date.now()}`;
      return {
        username: uname,
        email: opts?.email ?? `${uname}@example.com`,
        password: opts?.password ?? uname,
      };
    },
    /**
     * In case organizationId is passed, it simulates a scenario where a nonexistent user is added to an organization.
     */
    create: async (
      opts?:
        | (CustomUserOpts & {
            organizationId?: number | null;
            overrideDefaultEventTypes?: boolean;
          })
        | null,
      scenario: {
        seedRoutingForms?: boolean;
        seedRoutingFormWithAttributeRouting?: boolean;
        hasTeam?: true;
        numberOfTeams?: number;
        teamRole?: MembershipRole;
        teammates?: CustomUserOpts[];
        schedulingType?: SchedulingType;
        teamEventTitle?: string;
        teamEventSlug?: string;
        teamEventLength?: number;
        isOrg?: boolean;
        isOrgVerified?: boolean;
        isDnsSetup?: boolean;
        hasSubteam?: true;
        isUnpublished?: true;
        seatsPerTimeSlot?: number;
        addManagedEventToTeamMates?: boolean;
        managedEventUnlockedFields?: Record<string, boolean>;
        orgRequestedSlug?: string;
        assignAllTeamMembers?: boolean;
        assignAllTeamMembersForSubTeamEvents?: boolean;
      } = {}
    ) => {
      const _user = await prisma.user.create({
        data: createUser(workerInfo, opts),
        include: {
          profiles: true,
        },
      });

      let defaultEventTypes: SupportedTestEventTypes[] = opts?.overrideDefaultEventTypes
        ? []
        : [
            { title: "30 min", slug: "30-min", length: 30 },
            { title: "Paid", slug: "paid", length: 30, price: 1000 },
            { title: "Opt in", slug: "opt-in", requiresConfirmation: true, length: 30 },
            { title: "Seated", slug: "seated", seatsPerTimeSlot: 2, length: 30 },
            {
              title: "Multiple duration",
              slug: "multiple-duration",
              length: 30,
              metadata: { multipleDuration: [30, 60, 90] },
            },
          ];

      if (opts?.eventTypes) defaultEventTypes = defaultEventTypes.concat(opts.eventTypes);
      for (const eventTypeData of defaultEventTypes) {
        eventTypeData.owner = { connect: { id: _user.id } };
        eventTypeData.users = { connect: { id: _user.id } };
        if (_user.profiles[0]) {
          eventTypeData.profile = { connect: { id: _user.profiles[0].id } };
        }
        await prisma.eventType.create({
          data: eventTypeData,
        });
      }

      const workflows: SupportedTestWorkflows[] = [
        { name: "Default Workflow", trigger: "NEW_EVENT" },
        { name: "Test Workflow", trigger: "EVENT_CANCELLED" },
        ...(opts?.workflows || []),
      ];
      for (const workflowData of workflows) {
        workflowData.user = { connect: { id: _user.id } };
        await prisma.workflow.create({
          data: workflowData,
        });
      }

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: _user.id },
        include: userIncludes,
      });
      if (scenario.hasTeam) {
        const numberOfTeams = scenario.numberOfTeams || 1;
        for (let i = 0; i < numberOfTeams; i++) {
          const team = await createTeamAndAddUser(
            {
              user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: scenario.teamRole || "OWNER",
              },
              isUnpublished: scenario.isUnpublished,
              isOrg: scenario.isOrg,
              isOrgVerified: scenario.isOrgVerified,
              isDnsSetup: scenario.isDnsSetup,
              hasSubteam: scenario.hasSubteam,
              organizationId: opts?.organizationId,
              orgRequestedSlug: scenario.orgRequestedSlug,
              schedulingType: scenario.schedulingType,
              assignAllTeamMembersForSubTeamEvents: scenario.assignAllTeamMembersForSubTeamEvents,
            },
            workerInfo
          );
          store.teams.push(team);
          const teamEvent = await createTeamEventType(user, team, scenario);
          if (scenario.teammates) {
            // Create Teammate users
            const teamMates = [];
            for (const teammateObj of scenario.teammates) {
              const teamUser = await prisma.user.create({
                data: createUser(workerInfo, teammateObj),
              });

              // Add teammates to the team
              await prisma.membership.create({
                data: {
                  createdAt: new Date(),
                  teamId: team.id,
                  userId: teamUser.id,
                  role: MembershipRole.MEMBER,
                  accepted: true,
                },
              });

              // Add teammate to the host list of team event
              await prisma.host.create({
                data: {
                  userId: teamUser.id,
                  eventTypeId: teamEvent.id,
                  isFixed: scenario.schedulingType === SchedulingType.COLLECTIVE ? true : false,
                },
              });

              const teammateFixture = createUserFixture(
                await prisma.user.findUniqueOrThrow({
                  where: { id: teamUser.id },
                  include: userIncludes,
                }),
                store.page
              );
              teamMates.push(teamUser);
              store.users.push(teammateFixture);
            }
            // If the teamEvent is a managed one, we add the team mates to it.
            if (scenario.schedulingType === SchedulingType.MANAGED && scenario.addManagedEventToTeamMates) {
              await updateChildrenEventTypes({
                eventTypeId: teamEvent.id,
                currentUserId: user.id,
                oldEventType: {
                  team: null,
                },
                updatedEventType: teamEvent,
                children: teamMates.map((tm) => ({
                  hidden: false,
                  owner: {
                    id: tm.id,
                    name: tm.name || tm.username || "Nameless",
                    email: tm.email,
                    eventTypeSlugs: [],
                  },
                })),
                profileId: null,
                prisma,
                updatedValues: {},
              });
            }
            // Add Teammates to OrgUsers
            if (scenario.isOrg) {
              const orgProfilesCreate = teamMates
                .map((teamUser) => ({
                  user: {
                    connect: {
                      id: teamUser.id,
                    },
                  },
                  uid: v4(),
                  username: teamUser.username || teamUser.email.split("@")[0],
                }))
                .concat([
                  {
                    user: { connect: { id: user.id } },
                    uid: v4(),
                    username: user.username || user.email.split("@")[0],
                  },
                ]);

              const existingProfiles = await prisma.profile.findMany({
                where: {
                  userId: _user.id,
                },
              });

              await prisma.team.update({
                where: {
                  id: team.id,
                },
                data: {
                  orgProfiles: _user.profiles.length
                    ? {
                        connect: _user.profiles.map((profile) => ({ id: profile.id })),
                      }
                    : {
                        create: orgProfilesCreate.filter(
                          (profile) =>
                            !existingProfiles.map((p) => p.userId).includes(profile.user.connect.id)
                        ),
                      },
                },
              });
            }
          }
        }
      }

      const firstCreatedTeam = store.teams[0];
      if (scenario.seedRoutingForms) {
        if (!firstCreatedTeam) {
          throw new Error("No sub-team created");
        }
        await createRoutingForm({
          userId: _user.id,
          teamId: firstCreatedTeam.id,
          scenario,
        });
      }

      const finalUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: userIncludes,
      });
      const userFixture = createUserFixture(finalUser, store.page);
      store.users.push(userFixture);
      return userFixture;
    },
    /**
     * Use this method to get an email that can be automatically cleaned up from all the places in DB
     */
    trackEmail: ({ username, domain }: { username: string; domain: string }) => {
      const email = `${username}-${uuid().substring(0, 8)}@${domain}`;
      store.trackedEmails.push({
        email,
      });
      return email;
    },
    get: () => store.users,
    logout: async () => {
      await page.goto("/auth/logout");
    },
    deleteAll: async () => {
      const ids = store.users.map((u) => u.id);
      if (emails) {
        const emailMessageIds: string[] = [];
        for (const user of store.trackedEmails.concat(store.users.map((u) => ({ email: u.email })))) {
          const emailMessages = await emails.search(user.email);
          if (emailMessages && emailMessages.count > 0) {
            emailMessages.items.forEach((item) => {
              emailMessageIds.push(item.ID);
            });
          }
        }
        for (const id of emailMessageIds) {
          await emails.deleteMessage(id);
        }
      }

      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      // Delete all users that were tracked by email(if they were created)
      await prisma.user.deleteMany({ where: { email: { in: store.trackedEmails.map((e) => e.email) } } });
      await prisma.team.deleteMany({ where: { id: { in: store.teams.map((org) => org.id) } } });
      await prisma.secondaryEmail.deleteMany({ where: { userId: { in: ids } } });
      store.users = [];
      store.teams = [];
      store.trackedEmails = [];
    },
    delete: async (id: number) => {
      await prisma.user.delete({ where: { id } });
      store.users = store.users.filter((b) => b.id !== id);
    },
    deleteByEmail: async (email: string) => {
      // Use deleteMany instead of delete to avoid the findUniqueOrThrow error that happens before the delete
      await prisma.user.deleteMany({
        where: {
          email,
        },
      });
      store.users = store.users.filter((b) => b.email !== email);
    },
    set: async (email: string) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: userIncludes,
      });
      const userFixture = createUserFixture(user, store.page);
      store.users.push(userFixture);
      return userFixture;
    },
  };
};

type JSONValue = string | number | boolean | { [x: string]: JSONValue } | Array<JSONValue>;

// creates the single user fixture
const createUserFixture = (user: UserWithIncludes, page: Page) => {
  const store = { user, page };

  // self is a reflective method that return the Prisma object that references this fixture.
  const self = async () =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    (await prisma.user.findUnique({
      where: { id: store.user.id },
      include: { eventTypes: true },
    }))!;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    eventTypes: user.eventTypes,
    routingForms: user.routingForms,
    self,
    apiLogin: async (password?: string) =>
      apiLogin({ ...(await self()), password: password || user.username }, store.page),
    /** Don't forget to close context at the end */
    apiLoginOnNewBrowser: async (browser: Browser, password?: string) => {
      const newContext = await browser.newContext();
      const newPage = await newContext.newPage();
      await apiLogin({ ...(await self()), password: password || user.username }, newPage);
      // Don't forget to: newContext.close();
      return [newContext, newPage] as const;
    },
    /**
     * @deprecated use apiLogin instead
     */
    login: async () => login({ ...(await self()), password: user.username }, store.page),
    loginOnNewBrowser: async (browser: Browser) => {
      const newContext = await browser.newContext();
      const newPage = await newContext.newPage();
      await login({ ...(await self()), password: user.username }, newPage);
      // Don't forget to: newContext.close();
      return [newContext, newPage] as const;
    },
    logout: async () => {
      await page.goto("/auth/logout");
    },
    getFirstTeamMembership: async () => {
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
        include: { team: true },
      });

      const membership = memberships
        .map((membership) => {
          return {
            ...membership,
            team: {
              ...membership.team,
              metadata: teamMetadataSchema.parse(membership.team.metadata),
            },
          };
        })
        .find((membership) => !membership.team.isOrganization);
      if (!membership) {
        throw new Error("No team found for user");
      }
      return membership;
    },
    getOrgMembership: async () => {
      const membership = await prisma.membership.findFirstOrThrow({
        where: {
          userId: user.id,
          team: {
            isOrganization: true,
          },
        },
        include: {
          team: {
            include: {
              children: true,
              organizationSettings: true,
            },
          },
        },
      });
      if (!membership) {
        return membership;
      }

      return {
        ...membership,
        team: {
          ...membership.team,
          metadata: teamMetadataSchema.parse(membership.team.metadata),
        },
      };
    },
    getFirstEventAsOwner: async () =>
      prisma.eventType.findFirstOrThrow({
        where: {
          userId: user.id,
        },
      }),
    getUserEventsAsOwner: async () =>
      prisma.eventType.findMany({
        where: {
          userId: user.id,
        },
      }),
    getFirstTeamEvent: async (teamId: number, schedulingType?: SchedulingType) => {
      return prisma.eventType.findFirstOrThrow({
        where: {
          teamId,
          schedulingType,
        },
      });
    },
    setupEventWithPrice: async (eventType: Pick<Prisma.EventType, "id">, slug: string) =>
      setupEventWithPrice(eventType, slug, store.page),
    bookAndPayEvent: async (eventType: Pick<Prisma.EventType, "slug">) =>
      bookAndPayEvent(user, eventType, store.page),
    makePaymentUsingStripe: async () => makePaymentUsingStripe(store.page),
    installStripePersonal: async (params: InstallStripeParamsUnion) =>
      installStripePersonal({ page: store.page, ...params }),
    installStripeTeam: async (params: InstallStripeParamsUnion & { teamId: number }) =>
      installStripeTeam({ page: store.page, ...params }),
    // this is for development only aimed to inject debugging messages in the metadata field of the user
    debug: async (message: string | Record<string, JSONValue>) => {
      await prisma.user.update({
        where: { id: store.user.id },
        data: { metadata: { debug: message } },
      });
    },
    delete: async () => await prisma.user.delete({ where: { id: store.user.id } }),
    confirmPendingPayment: async () => confirmPendingPayment(store.page),
    getFirstProfile: async () => {
      return prisma.profile.findFirstOrThrow({
        where: {
          userId: user.id,
        },
      });
    },
  };
};

type SupportedTestEventTypes = PrismaType.EventTypeCreateInput & {
  _bookings?: PrismaType.BookingCreateInput[];
};

type SupportedTestWorkflows = PrismaType.WorkflowCreateInput;

type CustomUserOptsKeys =
  | "username"
  | "completedOnboarding"
  | "locale"
  | "name"
  | "email"
  | "organizationId"
  | "twoFactorEnabled"
  | "disableImpersonation"
  | "role"
  | "identityProvider";
type CustomUserOpts = Partial<Pick<Prisma.User, CustomUserOptsKeys>> & {
  timeZone?: TimeZoneEnum;
  eventTypes?: SupportedTestEventTypes[];
  workflows?: SupportedTestWorkflows[];
  // ignores adding the worker-index after username
  useExactUsername?: boolean;
  roleInOrganization?: MembershipRole;
  schedule?: Schedule;
  password?: string | null;
  emailDomain?: string;
  profileUsername?: string;
};

// creates the actual user in the db.
const createUser = (
  workerInfo: WorkerInfo,
  opts?:
    | (CustomUserOpts & {
        organizationId?: number | null;
      })
    | null
): PrismaType.UserUncheckedCreateInput => {
  const suffixToMakeUsernameUnique = `-${workerInfo.workerIndex}-${Date.now()}`;
  // build a unique name for our user
  const uname =
    opts?.useExactUsername && opts?.username
      ? opts.username
      : `${opts?.username || "user"}${suffixToMakeUsernameUnique}`;

  const emailDomain = opts?.emailDomain || "example.com";
  return {
    username: uname,
    name: opts?.name,
    email: opts?.email ?? `${uname}@${emailDomain}`,
    password: {
      create: {
        hash: hashPassword(uname),
      },
    },
    emailVerified: new Date(),
    completedOnboarding: opts?.completedOnboarding ?? true,
    timeZone: opts?.timeZone ?? TimeZoneEnum.UK,
    locale: opts?.locale ?? "en",
    role: opts?.role ?? "USER",
    twoFactorEnabled: opts?.twoFactorEnabled ?? false,
    disableImpersonation: opts?.disableImpersonation ?? false,
    ...getOrganizationRelatedProps({
      organizationId: opts?.organizationId,
      role: opts?.roleInOrganization,
      profileUsername: opts?.profileUsername,
    }),
    schedules:
      opts?.completedOnboarding ?? true
        ? {
            create: {
              name: "Working Hours",
              timeZone: opts?.timeZone ?? TimeZoneEnum.UK,
              availability: {
                createMany: {
                  data: getAvailabilityFromSchedule(opts?.schedule ?? DEFAULT_SCHEDULE),
                },
              },
            },
          }
        : undefined,
    identityProvider: opts?.identityProvider,
  };

  function getOrganizationRelatedProps({
    organizationId,
    role,
    profileUsername,
  }: {
    organizationId: number | null | undefined;
    role: MembershipRole | undefined;
    profileUsername?: string;
  }) {
    if (!organizationId) {
      return null;
    }
    if (!role) {
      throw new Error("Missing role for user in organization");
    }
    return {
      organizationId,
      profiles: {
        create: {
          uid: ProfileRepository.generateProfileUid(),
          username: profileUsername ? `${profileUsername}${suffixToMakeUsernameUnique}` : uname,
          organization: {
            connect: {
              id: organizationId,
            },
          },
        },
      },
      teams: {
        // Create membership
        create: [
          {
            team: {
              connect: {
                id: organizationId,
              },
            },
            accepted: true,
            role,
          },
        ],
      },
    };
  }
};

async function confirmPendingPayment(page: Page) {
  await page.waitForURL(new RegExp("/booking/*"));

  const url = page.url();

  const params = new URLSearchParams(url.split("?")[1]);

  const id = params.get("payment_intent");

  if (!id) throw new Error(`Payment intent not found in url ${url}`);

  const payload = JSON.stringify(
    { type: "payment_intent.succeeded", data: { object: { id } }, account: "e2e_test" },
    null,
    2
  );

  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  });

  const response = await page.request.post("/api/integrations/stripepayment/webhook", {
    data: payload,
    headers: { "stripe-signature": signature },
  });

  if (response.status() !== 200)
    throw new Error(`Failed to confirm payment. Response: ${await response.text()}`);
}

// login using a replay of an E2E routine.
export async function login(
  user: Pick<Prisma.User, "username"> & Partial<Pick<Prisma.User, "email">> & { password?: string | null },
  page: Page
) {
  // get locators
  const loginLocator = page.locator("[data-testid=login-form]");
  const emailLocator = loginLocator.locator("#email");
  const passwordLocator = loginLocator.locator("#password");
  const signInLocator = loginLocator.locator('[type="submit"]');

  //login
  await page.goto("/");
  await page.waitForSelector("text=Welcome back");

  await emailLocator.fill(user.email ?? `${user.username}@example.com`);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  await passwordLocator.fill(user.password ?? user.username!);

  // waiting for specific login request to resolve
  const responsePromise = page.waitForResponse(/\/api\/auth\/callback\/credentials/);
  await signInLocator.click();
  await responsePromise;
}

export async function apiLogin(
  user: Pick<Prisma.User, "username"> & Partial<Pick<Prisma.User, "email">> & { password: string | null },
  page: Page
) {
  const csrfToken = await page
    .context()
    .request.get("/api/auth/csrf")
    .then((response) => response.json())
    .then((json) => json.csrfToken);
  const data = {
    email: user.email ?? `${user.username}@example.com`,
    password: user.password ?? user.username,
    callbackURL: WEBAPP_URL,
    redirect: "false",
    json: "true",
    csrfToken,
  };
  const response = await page.context().request.post("/api/auth/callback/credentials", {
    data,
  });
  expect(response.status()).toBe(200);
  return response;
}

export async function setupEventWithPrice(eventType: Pick<Prisma.EventType, "id">, slug: string, page: Page) {
  await page.goto(`/event-types/${eventType?.id}?tabName=apps`);
  await page.locator(`[data-testid='${slug}-app-switch']`).first().click();
  await page.getByPlaceholder("Price").fill("100");
  await page.getByTestId("update-eventtype").click();
}

export async function bookAndPayEvent(
  user: Pick<Prisma.User, "username">,
  eventType: Pick<Prisma.EventType, "slug">,
  page: Page
) {
  // booking process with stripe integration
  await page.goto(`${user.username}/${eventType?.slug}`);
  await selectFirstAvailableTimeSlotNextMonth(page);
  // --- fill form
  await page.fill('[name="name"]', "Stripe Stripeson");
  await page.fill('[name="email"]', "test@example.com");

  await Promise.all([page.waitForURL("/payment/*"), page.press('[name="email"]', "Enter")]);

  await makePaymentUsingStripe(page);
}

export async function makePaymentUsingStripe(page: Page) {
  const stripeElement = await page.locator(".StripeElement").first();
  const stripeFrame = stripeElement.frameLocator("iframe").first();
  await stripeFrame.locator('[name="number"]').fill("4242 4242 4242 4242");
  const now = new Date();
  await stripeFrame.locator('[name="expiry"]').fill(`${now.getMonth() + 1} / ${now.getFullYear() + 1}`);
  await stripeFrame.locator('[name="cvc"]').fill("111");
  const postcalCodeIsVisible = await stripeFrame.locator('[name="postalCode"]').isVisible();
  if (postcalCodeIsVisible) {
    await stripeFrame.locator('[name="postalCode"]').fill("111111");
  }
  await page.click('button:has-text("Pay now")');
}

const installStripePersonal = async (params: InstallStripePersonalPramas) => {
  const redirectUrl = `apps/installation/event-types?slug=stripe`;
  const buttonSelector = '[data-testid="install-app-button-personal"]';
  await installStripe({ redirectUrl, buttonSelector, ...params });
};

const installStripeTeam = async ({ teamId, ...params }: InstallStripeTeamPramas) => {
  const redirectUrl = `apps/installation/event-types?slug=stripe&teamId=${teamId}`;
  const buttonSelector = `[data-testid="install-app-button-team${teamId}"]`;
  await installStripe({ redirectUrl, buttonSelector, ...params });
};
const installStripe = async ({
  page,
  skip,
  eventTypeIds,
  redirectUrl,
  buttonSelector,
}: InstallStripeParams) => {
  await page.goto("/apps/stripe");
  /** We start the Stripe flow */
  await page.click('[data-testid="install-app-button"]');
  await page.click(buttonSelector);

  await page.waitForURL("https://connect.stripe.com/oauth/v2/authorize?*");
  /** We skip filling Stripe forms (testing mode only) */
  await page.click('[id="skip-account-app"]');
  await page.waitForURL(redirectUrl);
  if (skip) {
    await page.click('[data-testid="set-up-later"]');
    return;
  }
  for (const id of eventTypeIds) {
    await page.click(`[data-testid="select-event-type-${id}"]`);
  }
  await page.click(`[data-testid="save-event-types"]`);
  for (let index = 0; index < eventTypeIds.length; index++) {
    await page.locator('[data-testid="stripe-price-input"]').nth(index).fill(`1${index}`);
  }
  await page.click(`[data-testid="configure-step-save"]`);
  await page.waitForURL(`event-types`);
  for (let index = 0; index < eventTypeIds.length; index++) {
    await page.goto(`event-types/${eventTypeIds[index]}?tabName=apps`);
    await expect(page.getByTestId(`stripe-app-switch`)).toBeChecked();
    await expect(page.getByTestId(`stripe-price-input`)).toHaveValue(`1${index}`);
  }
};
