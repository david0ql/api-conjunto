import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { CallSessionStatus } from './entities/call-session.entity';

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
  apartmentId: string;
  apartment: CallApartmentSummary | null;
  initiatedByEmployeeId: string;
  initiatedByEmployee: CallPeerSummary | null;
  acceptedByResidentId: string | null;
  acceptedByResident: CallPeerSummary | null;
  targetResidentIds: string[];
  rejectedResidentIds: string[];
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
