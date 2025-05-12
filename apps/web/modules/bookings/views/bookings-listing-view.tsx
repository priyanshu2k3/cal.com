"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  type VisibilityState,
  type SortingState,
} from "@tanstack/react-table";
import { useMemo, useRef, useState } from "react";

import { WipeMyCalActionButton } from "@calcom/app-store/wipemycalother/components";
import dayjs from "@calcom/dayjs";
import {
  useDataTable,
  DataTableProvider,
  DataTableWrapper,
  DataTableFilters,
  DataTableSegment,
  ColumnFilterType,
  useFilterValue,
  ZMultiSelectFilterValue,
  ZDateRangeFilterValue,
  ZTextFilterValue,
} from "@calcom/features/data-table";
import { useSegments } from "@calcom/features/data-table/hooks/useSegments";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Alert } from "@calcom/ui/components/alert";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";
import type { HorizontalTabItemProps } from "@calcom/ui/components/navigation";
import { HorizontalTabs } from "@calcom/ui/components/navigation";
import type { VerticalTabItemProps } from "@calcom/ui/components/navigation";

import useMeQuery from "@lib/hooks/useMeQuery";

import BookingListItem from "@components/booking/BookingListItem";
import SkeletonLoader from "@components/booking/SkeletonLoader";

import { useFacetedUniqueValues } from "~/bookings/hooks/useFacetedUniqueValues";
import type { validStatuses } from "~/bookings/lib/validStatuses";

import { DateColumn, TimeColumn, EventColumn, TeamColumn } from "../components/columns";

type BookingListingStatus = (typeof validStatuses)[number];
type BookingOutput = RouterOutputs["viewer"]["bookings"]["get"]["bookings"][0];

type RecurringInfo = {
  recurringEventId: string | null;
  count: number;
  firstDate: Date | null;
  bookings: { [key: string]: Date[] };
};

const tabs: (VerticalTabItemProps | HorizontalTabItemProps)[] = [
  {
    name: "upcoming",
    href: "/bookings/upcoming",
    "data-testid": "upcoming",
  },
  {
    name: "unconfirmed",
    href: "/bookings/unconfirmed",
    "data-testid": "unconfirmed",
  },
  {
    name: "recurring",
    href: "/bookings/recurring",
    "data-testid": "recurring",
  },
  {
    name: "past",
    href: "/bookings/past",
    "data-testid": "past",
  },
  {
    name: "cancelled",
    href: "/bookings/cancelled",
    "data-testid": "cancelled",
  },
];

const descriptionByStatus: Record<BookingListingStatus, string> = {
  upcoming: "upcoming_bookings",
  recurring: "recurring_bookings",
  past: "past_bookings",
  cancelled: "cancelled_bookings",
  unconfirmed: "unconfirmed_bookings",
};

type BookingsProps = {
  status: (typeof validStatuses)[number];
};

export default function Bookings(props: BookingsProps) {
  return (
    <DataTableProvider useSegments={useSegments}>
      <BookingsContent {...props} />
    </DataTableProvider>
  );
}

type RowData =
  | {
      type: "data";
      booking: BookingOutput;
      isToday: boolean;
      recurringInfo?: RecurringInfo;
    }
  | {
      type: "today" | "next";
    };

function BookingsTable({
  data,
  columns,
  title,
  tableContainerRef,
  query,
  isEmpty,
  status,
  t,
  table,
  hideToolbar = false,
  toolbarComponent: ToolbarComponent,
}: {
  data: RowData[];
  columns: any[];
  title?: string;
  tableContainerRef: React.RefObject<HTMLDivElement>;
  query: any;
  isEmpty: boolean;
  status: BookingListingStatus;
  t: any;
  table: any;
  hideToolbar?: boolean;
  toolbarComponent?: React.ComponentType;
}) {
  return (
    <>
      {title && <h3 className="mb-4 font-medium text-gray-900">{title}</h3>}
      <DataTableWrapper
        className="mb-6"
        tableContainerRef={tableContainerRef}
        table={table}
        testId={`${status}-bookings`}
        bodyTestId="bookings"
        isPending={query.isPending}
        totalRowCount={data.length}
        paginationMode="standard"
        ToolbarLeft={!hideToolbar && ToolbarComponent && <ToolbarComponent />}
        LoaderView={<SkeletonLoader />}
        EmptyView={
          <div className="flex items-center justify-center pt-2 xl:pt-0">
            <EmptyScreen
              Icon="calendar"
              headline={t("no_status_bookings_yet", { status: t(status).toLowerCase() })}
              description={t("no_status_bookings_yet_description", {
                status: t(status).toLowerCase(),
                description: t(descriptionByStatus[status]),
              })}
            />
          </div>
        }
      />
    </>
  );
}

function BookingsContent({ status }: BookingsProps) {
  const { t } = useLocale();
  const user = useMeQuery().data;
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const todayTableContainerRef = useRef<HTMLDivElement>(null);

  const eventTypeIds = useFilterValue("eventTypeId", ZMultiSelectFilterValue)?.data as number[] | undefined;
  const teamIds = useFilterValue("teamId", ZMultiSelectFilterValue)?.data as number[] | undefined;
  const userIds = useFilterValue("userId", ZMultiSelectFilterValue)?.data as number[] | undefined;
  const dateRange = useFilterValue("dateRange", ZDateRangeFilterValue)?.data;
  const attendeeName = useFilterValue("attendeeName", ZTextFilterValue);
  const attendeeEmail = useFilterValue("attendeeEmail", ZTextFilterValue);

  const { limit, offset } = useDataTable();

  const query = trpc.viewer.bookings.get.useQuery({
    limit,
    offset,
    filters: {
      status,
      eventTypeIds,
      teamIds,
      userIds,
      attendeeName,
      attendeeEmail,
      afterStartDate: dateRange?.startDate
        ? dayjs(dateRange?.startDate).startOf("day").toISOString()
        : undefined,
      beforeEndDate: dateRange?.endDate ? dayjs(dateRange?.endDate).endOf("day").toISOString() : undefined,
    },
  });

  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<RowData>();

    return [
      columnHelper.accessor((row) => row.type === "data" && row.booking.eventType.id, {
        id: "eventTypeId",
        header: t("event_type"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.MULTI_SELECT,
          },
        },
      }),
      columnHelper.accessor((row) => row.type === "data" && row.booking.eventType.team?.id, {
        id: "teamId",
        header: t("team"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.MULTI_SELECT,
          },
        },
      }),
      columnHelper.accessor((row) => row.type === "data" && row.booking.user?.id, {
        id: "userId",
        header: t("member"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.MULTI_SELECT,
          },
        },
      }),
      columnHelper.accessor((row) => row, {
        id: "attendeeName",
        header: t("attendee_name"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.TEXT,
          },
        },
      }),
      columnHelper.accessor((row) => row, {
        id: "attendeeEmail",
        header: t("attendee_email_variable"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.TEXT,
          },
        },
      }),
      columnHelper.accessor((row) => row, {
        id: "dateRange",
        header: t("date_range"),
        enableColumnFilter: true,
        enableSorting: false,
        cell: () => null,
        meta: {
          filter: {
            type: ColumnFilterType.DATE_RANGE,
            dateRangeOptions: {
              range: status === "past" ? "past" : "custom",
            },
          },
        },
      }),

      columnHelper.display({
        id: "date",
        header: t("date"),
        cell: (props) => {
          if (props.row.original.type === "data") {
            return (
              <DateColumn
                startTime={props.row.original.booking.startTime}
                userTimeZone={user?.timeZone}
                isUpcoming={status === "upcoming"}
              />
            );
          }
          return null;
        },
      }),

      columnHelper.display({
        id: "time",
        header: t("time"),
        cell: (props) => {
          if (props.row.original.type === "data") {
            return (
              <TimeColumn
                startTime={props.row.original.booking.startTime}
                endTime={props.row.original.booking.endTime}
                userTimeZone={user?.timeZone}
                userTimeFormat={user?.timeFormat}
                attendees={props.row.original.booking.attendees}
              />
            );
          }
          return null;
        },
      }),

      columnHelper.display({
        id: "event",
        header: t("event"),
        cell: (props) => {
          if (props.row.original.type === "data") {
            const { booking } = props.row.original;
            return (
              <EventColumn
                title={booking.title}
                description={booking.description}
                isCancelled={booking.status === "CANCELLED"}
                showPendingPayment={!!(booking.payment.length && !booking.paid)}
              />
            );
          }
          return null;
        },
      }),

      columnHelper.display({
        id: "team",
        header: t("team"),
        cell: (props) => {
          if (props.row.original.type === "data") {
            return <TeamColumn teamName={props.row.original.booking.eventType.team?.name} />;
          }
          return null;
        },
      }),

      columnHelper.display({
        id: "actions",
        header: () => null,
        cell: (props) => {
          if (props.row.original.type === "data") {
            const { booking, recurringInfo, isToday } = props.row.original;
            return (
              <BookingListItem
                {...booking}
                listingStatus={status}
                recurringInfo={recurringInfo}
                isToday={isToday}
                loggedInUser={{
                  userId: user?.id,
                  userTimeZone: user?.timeZone,
                  userTimeFormat: user?.timeFormat,
                  userEmail: user?.email,
                }}
              />
            );
          }
          return null;
        },
      }),
    ];
  }, [user, status, t]);

  const isEmpty = useMemo(() => !query.data?.bookings.length, [query.data]);

  const flatData = useMemo<RowData[]>(() => {
    const shownBookings: Record<string, BookingOutput[]> = {};
    const filterBookings = (booking: BookingOutput) => {
      if (["recurring", "unconfirmed", "cancelled"].includes(status)) {
        if (!booking.recurringEventId) {
          return true;
        }
        if (
          shownBookings[booking.recurringEventId] !== undefined &&
          shownBookings[booking.recurringEventId].length > 0
        ) {
          shownBookings[booking.recurringEventId].push(booking);
          return false;
        }
        shownBookings[booking.recurringEventId] = [booking];
      } else if (status === "upcoming") {
        return (
          dayjs(booking.startTime).tz(user?.timeZone).format("YYYY-MM-DD") !==
          dayjs().tz(user?.timeZone).format("YYYY-MM-DD")
        );
      }
      return true;
    };

    return (
      query.data?.bookings.filter(filterBookings).map((booking) => ({
        type: "data",
        booking,
        recurringInfo: query.data?.recurringInfo.find(
          (info) => info.recurringEventId === booking.recurringEventId
        ),
        isToday: false,
      })) || []
    );
  }, [query.data]);

  const bookingsToday = useMemo<RowData[]>(() => {
    return (
      query.data?.bookings
        .filter(
          (booking: BookingOutput) =>
            dayjs(booking.startTime).tz(user?.timeZone).format("YYYY-MM-DD") ===
            dayjs().tz(user?.timeZone).format("YYYY-MM-DD")
        )
        .map((booking) => ({
          type: "data" as const,
          booking,
          recurringInfo: query.data?.recurringInfo.find(
            (info) => info.recurringEventId === booking.recurringEventId
          ),
          isToday: true,
        })) ?? []
    );
  }, [query.data]);

  const finalData = useMemo<RowData[]>(() => {
    if (status !== "upcoming") {
      return flatData;
    }
    const merged: RowData[] = [];
    if (bookingsToday.length > 0) {
      merged.push(...bookingsToday);
    }
    if (flatData.length > 0) {
      merged.push(...flatData);
    }
    return merged;
  }, [bookingsToday, flatData, status]);

  console.log(finalData);

  const getFacetedUniqueValues = useFacetedUniqueValues();

  // Create a shared state for column visibility
  const [sharedColumnVisibility, setSharedColumnVisibility] = useState<VisibilityState>({
    eventTypeId: false,
    teamId: false,
    userId: false,
    attendeeName: false,
    attendeeEmail: false,
    dateRange: false,
  });

  // Create a shared state for sorting
  const [sharedSorting, setSharedSorting] = useState<SortingState>([]);

  const commonTableOptions = {
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedUniqueValues,
    enableSorting: true,
    initialState: {
      columnVisibility: sharedColumnVisibility,
    },
    onColumnVisibilityChange: setSharedColumnVisibility,
    onSortingChange: setSharedSorting,
    state: {
      sorting: sharedSorting,
      columnVisibility: sharedColumnVisibility,
    },
  };

  const todayTable = useReactTable<RowData>({
    ...commonTableOptions,
    data: bookingsToday,
  });

  const upcomingTable = useReactTable<RowData>({
    ...commonTableOptions,
    data: flatData,
  });

  const defaultTable = useReactTable<RowData>({
    ...commonTableOptions,
    data: finalData,
  });

  // Create a shared toolbar component
  const SharedToolbar = () => (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DataTableFilters.FilterBar table={status === "upcoming" ? upcomingTable : defaultTable} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DataTableFilters.ClearFiltersButton />
        <DataTableSegment.SaveButton />
        <DataTableSegment.Select />
      </div>
    </>
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-row flex-wrap justify-between">
        <HorizontalTabs
          tabs={tabs.map((tab) => ({
            ...tab,
            name: t(tab.name),
          }))}
        />
      </div>
      <main className="w-full">
        <div className="flex w-full flex-col">
          {query.status === "error" && (
            <Alert severity="error" title={t("something_went_wrong")} message={query.error.message} />
          )}
          {query.status !== "error" && (
            <>
              {status === "upcoming" && (
                <>
                  {!!bookingsToday.length && (
                    <WipeMyCalActionButton bookingStatus={status} bookingsEmpty={isEmpty} />
                  )}
                  <SharedToolbar />
                  {!!bookingsToday.length && (
                    <BookingsTable
                      data={bookingsToday}
                      columns={columns}
                      title={t("today_bookings")}
                      tableContainerRef={todayTableContainerRef}
                      query={query}
                      isEmpty={!bookingsToday.length}
                      status={status}
                      t={t}
                      table={todayTable}
                      hideToolbar={true}
                      toolbarComponent={SharedToolbar}
                    />
                  )}
                  <BookingsTable
                    data={flatData}
                    columns={columns}
                    title={t("upcoming_bookings")}
                    tableContainerRef={tableContainerRef}
                    query={query}
                    isEmpty={!flatData.length}
                    status={status}
                    t={t}
                    table={upcomingTable}
                    hideToolbar={true}
                    toolbarComponent={SharedToolbar}
                  />
                </>
              )}
              {status !== "upcoming" && (
                <BookingsTable
                  data={finalData}
                  columns={columns}
                  tableContainerRef={tableContainerRef}
                  query={query}
                  isEmpty={isEmpty}
                  status={status}
                  t={t}
                  table={defaultTable}
                  toolbarComponent={SharedToolbar}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
