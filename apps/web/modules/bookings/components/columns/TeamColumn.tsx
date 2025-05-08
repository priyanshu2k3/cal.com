import { Badge } from "@calcom/ui/components/badge";

type TeamColumnProps = {
  teamName?: string | null;
};

export const TeamColumn = ({ teamName }: TeamColumnProps) => {
  if (!teamName) return null;

  return (
    <Badge className="ltr:mr-2 rtl:ml-2" variant="gray">
      {teamName}
    </Badge>
  );
};
