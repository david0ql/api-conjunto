import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { CallDirection, CallSessionStatus } from './entities/call-session.entity';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CallPeerSummary {
  id: string;
  name: string;
  lastName: string;
}

export interface CallPorterAvailabilityPayload {
  id: string;
  username: string;
  name: string;
  lastName: string;
  available: boolean;
  status: 'available' | 'busy';
  currentCall: {
    callId: string;
    direction: CallDirection;
    status: Extract<CallSessionStatus, 'ringing' | 'active'>;
    withType: 'resident' | 'employee' | 'apartment';
    withLabel: string;
    apartment: CallApartmentSummary | null;
  } | null;
}

export interface CallApartmentSummary {
  id: string;
  number: string;
  floor: number | null;
  tower: {
    id: string;
    code: string;
    name: string;
  } | null;
}

export interface CallSessionPayload {
  id: string;
  status: CallSessionStatus;
  direction: CallDirection;
  apartmentId: string | null;
  apartment: CallApartmentSummary | null;
  initiatedByEmployeeId: string | null;
  initiatedByEmployee: CallPeerSummary | null;
  initiatedByResidentId: string | null;
  initiatedByResident: CallPeerSummary | null;
  acceptedByResidentId: string | null;
  acceptedByResident: CallPeerSummary | null;
  acceptedByEmployeeId: string | null;
  acceptedByEmployee: CallPeerSummary | null;
  targetResidentIds: string[];
  targetEmployeeIds: string[];
  rejectedResidentIds: string[];
  rejectedEmployeeIds: string[];
  endedByUserId: string | null;
  endedByUserType: JwtPayload['type'] | null;
  endedReason: string | null;
  createdAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
}

export interface CallSignalEnvelope {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  };
}
