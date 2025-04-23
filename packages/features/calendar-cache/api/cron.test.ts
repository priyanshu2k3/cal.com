import type { NextApiRequest } from "next";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { SelectedCalendarRepository } from "@calcom/lib/server/repository/selectedCalendar";

import { CalendarCache } from "../calendar-cache";
import handler from "./cron";

// Mock dependencies
vi.mock("@calcom/lib/server/repository/selectedCalendar");
vi.mock("../calendar-cache");

describe("Calendar Cache Cron", () => {
  let mockRequest: Partial<NextApiRequest>;
  const mockApiKey = "test-api-key";
  const mockResponse = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup environment variables
    process.env.CRON_API_KEY = mockApiKey;

    // Setup mock request
    mockRequest = {
      method: "GET",
      headers: { authorization: mockApiKey },
      query: {},
    };
  });

  describe("Calendar Operations", () => {
    const mockCalendar = {
      externalId: "test-calendar-id",
      eventTypeId: 1,
      credentialId: 1,
      id: "test-id",
    };

    const mockCalendarCache = {
      watchCalendar: vi.fn().mockResolvedValue(undefined),
      unwatchCalendar: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
      // Mock repository methods
      vi.mocked(SelectedCalendarRepository.getNextBatchToWatch).mockResolvedValue([mockCalendar]);
      vi.mocked(SelectedCalendarRepository.getNextBatchToUnwatch).mockResolvedValue([mockCalendar]);
      vi.mocked(SelectedCalendarRepository.updateById).mockResolvedValue(undefined);

      // Mock CalendarCache
      vi.mocked(CalendarCache.initFromCredentialId).mockResolvedValue(mockCalendarCache);
    });

    it("should handle watch and unwatch operations successfully", async () => {
      const response = await handler(mockRequest as NextApiRequest, mockResponse);
      expect(mockResponse.json).toHaveBeenCalledWith({
        executedAt: expect.any(String),
      });

      expect(SelectedCalendarRepository.getNextBatchToWatch).toHaveBeenCalledTimes(1);
      expect(SelectedCalendarRepository.getNextBatchToUnwatch).toHaveBeenCalledTimes(1);
      expect(CalendarCache.initFromCredentialId).toHaveBeenCalledWith(mockCalendar.credentialId);
      expect(mockCalendarCache.watchCalendar).toHaveBeenCalledWith({
        calendarId: mockCalendar.externalId,
        eventTypeIds: [mockCalendar.eventTypeId],
      });
      expect(mockCalendarCache.unwatchCalendar).toHaveBeenCalledWith({
        calendarId: mockCalendar.externalId,
        eventTypeIds: [mockCalendar.eventTypeId],
      });
    });

    it("should handle missing credentialId", async () => {
      const calendarWithoutCredential = { ...mockCalendar, credentialId: null };
      vi.mocked(SelectedCalendarRepository.getNextBatchToWatch).mockResolvedValue([
        calendarWithoutCredential,
      ]);
      vi.mocked(SelectedCalendarRepository.getNextBatchToUnwatch).mockResolvedValue([
        calendarWithoutCredential,
      ]);

      await handler(mockRequest as NextApiRequest, mockResponse);

      expect(SelectedCalendarRepository.updateById).toHaveBeenCalledWith(calendarWithoutCredential.id, {
        error: "Missing credentialId",
      });
      expect(CalendarCache.initFromCredentialId).not.toHaveBeenCalled();
    });

    it("should handle calendar operation errors", async () => {
      const mockError = new Error("Calendar operation failed");
      mockCalendarCache.watchCalendar.mockRejectedValueOnce(mockError);

      await handler(mockRequest as NextApiRequest, mockResponse);

      expect(SelectedCalendarRepository.updateById).toHaveBeenCalledWith(mockCalendar.id, {
        error: mockError.message,
      });
    });

    it("should handle non-Error objects in catch block", async () => {
      const mockError = "String error";
      mockCalendarCache.watchCalendar.mockRejectedValueOnce(mockError);

      await handler(mockRequest as NextApiRequest, mockResponse);

      expect(SelectedCalendarRepository.updateById).toHaveBeenCalledWith(mockCalendar.id, {
        error: String(mockError),
      });
    });
  });
});
