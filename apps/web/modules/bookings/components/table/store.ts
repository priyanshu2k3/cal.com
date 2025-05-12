import type { VisibilityState, SortingState, ColumnFiltersState } from "@tanstack/react-table";
import { create } from "zustand";

interface BookingsTableStore {
  columnVisibility: VisibilityState;
  setColumnVisibility: (columnVisibility: VisibilityState) => void;
  sorting: SortingState;
  setSorting: (sorting: SortingState) => void;
  columnFilters: ColumnFiltersState;
  setColumnFilters: (columnFilters: ColumnFiltersState) => void;
}

export const useBookingsTableStore = create<BookingsTableStore>((set) => ({
  columnVisibility: {
    eventTypeId: false,
    teamId: false,
    userId: false,
    attendeeName: false,
    attendeeEmail: false,
    dateRange: false,
  },
  setColumnVisibility: (columnVisibility) => set({ columnVisibility }),
  sorting: [],
  setSorting: (sorting) => set({ sorting }),
  columnFilters: [],
  setColumnFilters: (columnFilters) => set({ columnFilters }),
}));
