import type { CopyBank } from "../game/types";

export const FULL_AUDIT_COPY: CopyBank = {
  callouts: [
    "ANNUAL AUDIT FAILED",
    "ONE OR MORE STATIONS REJECTED",
    "PARTIAL HUMANITY LOGGED",
    "INTERDEPARTMENTAL NON-COMPLIANCE",
    "AUDIT PANEL UNCONVINCED",
    "APPEALS ARE NOT ACCEPTED",
    "MULTISTAGE CHECK FAILED",
    "INCOMPLETE BIOLOGICAL CLEARANCE",
    "REVIEW BOARD NOTIFIED",
    "STATION DEFICIT RECORDED",
  ],
  transitions: [
    "Forwarding dossier to next desk.",
    "Do not adjust posture between stations.",
    "Next compliance clerk is waiting.",
    "Routing directly to secondary screening.",
    "Advancing file without comment.",
    "Transferring temporary clearance.",
    "Proceeding to next inspection booth.",
  ],
};
