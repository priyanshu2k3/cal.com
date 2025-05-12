import type { Table } from "@tanstack/react-table";

import { DataTableFilters, DataTableSegment } from "@calcom/features/data-table";

import type { RowData } from "../../lib/types";

interface BookingsTableToolbarProps {
  table: Table<RowData>;
}

export function BookingsTableToolbar({ table }: BookingsTableToolbarProps) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <DataTableFilters.FilterBar table={table} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DataTableFilters.ClearFiltersButton />
        <DataTableSegment.SaveButton />
        <DataTableSegment.Select />
      </div>
    </div>
  );
}
