import type { Room, TeamDoc } from '../game/types';

/**
 * 저장소 — Firebase(온라인) 또는 로컬(같은 브라우저 탭끼리)
 *  - rooms/{code}             : 방 상태 (공개 정보, 라운드 판정 결과)
 *  - rooms/{code}/teams/{id}  : 모둠별 이번 라운드 주사위·퀴즈·선택 (그 모둠만 씀 → 10모둠 동시 저장해도 충돌 없음)
 */
export interface RoomStore {
  readonly kind: 'firebase' | 'local';
  init(): Promise<void>;
  createRoom(room: Room): Promise<boolean>;
  roomExists(code: string): Promise<boolean>;
  subscribeRoom(code: string, cb: (room: Room | null) => void, onError?: (e: unknown) => void): () => void;
  subscribeTeams(code: string, cb: (docs: TeamDoc[]) => void, onError?: (e: unknown) => void): () => void;
  subscribeTeam(code: string, id: string, cb: (doc: TeamDoc | null) => void, onError?: (e: unknown) => void): () => void;
  /** 방 문서 트랜잭션. fn이 null을 돌려주면 쓰지 않음 */
  updateRoom(code: string, fn: (room: Room) => Room | null): Promise<Room>;
  /** 모둠 문서 트랜잭션 (방 상태를 함께 읽어 검증) */
  updateTeam(code: string, id: string, fn: (doc: TeamDoc | null, room: Room) => TeamDoc): Promise<TeamDoc>;
  /** 라운드 판정 등: 방 + 모든 모둠 문서를 읽고 방을 갱신. fn이 null을 돌려주면 아무것도 안 함 */
  updateRoomWithTeams(code: string, fn: (room: Room, docs: Record<string, TeamDoc | null>) => Room | null): Promise<Room | null>;
}

/** Firestore는 undefined를 허용하지 않으므로 직렬화로 정리 */
export function sanitize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  appId?: string;
  [k: string]: unknown;
}

declare global {
  interface Window {
    FIREBASE_CONFIG?: Partial<FirebaseWebConfig>;
  }
}

export function readFirebaseConfig(): FirebaseWebConfig | null {
  const params = new URLSearchParams(location.search);
  if (params.get('local') === '1') return null;
  const c = window.FIREBASE_CONFIG;
  if (c && typeof c.apiKey === 'string' && c.apiKey && typeof c.projectId === 'string' && c.projectId) {
    return c as FirebaseWebConfig;
  }
  return null;
}
