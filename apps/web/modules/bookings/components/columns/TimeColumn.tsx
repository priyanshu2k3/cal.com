import dayjs from "@calcom/dayjs";
import { MeetingTimeInTimezones } from "@calcom/ui/components/popover";

type Attendee = {
  id: number;
  email: string;
  phoneNumber?: string | null;
  name: string;
  timeZone: string;
  locale: string | null;
  bookingId: number | null;
};

type TimeColumnProps = {
  startTime: string;
  endTime: string;
  userTimeZone?: string;
  userTimeFormat?: number | null;
  attendees: Attendee[];
};

export const TimeColumn = ({
  startTime,
  endTime,
  userTimeZone,
  userTimeFormat,
  attendees,
}: TimeColumnProps) => {
  const timeRange = `${dayjs(startTime)
    .tz(userTimeZone)
    .format(userTimeFormat === 12 ? "h:mma" : "HH:mm")}-${dayjs(endTime)
    .tz(userTimeZone)
    .format(userTimeFormat === 12 ? "h:mma" : "HH:mm")}`;

  return (
    <div className="text-subtle text-sm">
      {timeRange}
      <MeetingTimeInTimezones
        timeFormat={userTimeFormat}
        userTimezone={userTimeZone}
        startTime={startTime}
        endTime={endTime}
        attendees={attendees}
      />
    </div>
  );
};
