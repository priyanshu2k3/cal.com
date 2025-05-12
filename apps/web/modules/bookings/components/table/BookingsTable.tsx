import type { Row } from "@tanstack/react-table";

import { DataTableWrapper } from "@calcom/features/data-table";
import { EmptyScreen } from "@calcom/ui/components/empty-screen";

import SkeletonLoader from "@components/booking/SkeletonLoader";

import type { BookingListingStatus, RowData } from "../../lib/types";
import { descriptionByStatus } from "../../lib/types";

interface BookingsTableProps {
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
  onRowClick?: (row: Row<RowData>) => void;
}

export function BookingsTable({
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
  onRowClick,
}: BookingsTableProps) {
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
        onRowMouseclick={onRowClick}
      />
    </>
  );
}
