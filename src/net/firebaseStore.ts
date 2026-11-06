import type { Room, TeamDoc } from '../game/types';
import { sanitize, type FirebaseWebConfig, type RoomStore } from './store';

/**
 * Firebase(Firestore) 온라인 모드.
 * - Firebase SDK는 공식 CDN(gstatic)에서 불러오므로 npm 설치가 필요 없습니다.
 * - 학생 태블릿은 계정 없이 '익명 로그인'으로 자동 접속합니다.
 */
const SDK_VERSION = '11.0.2';
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

// ── 사용하는 SDK 함수의 최소 타입 ──
type Unsub = () => void;
interface Snap { exists(): boolean; data(): unknown }
interface QuerySnap { docs: Snap[] }
interface Tx {
  get(ref: unknown): Promise<Snap>;
  set(ref: unknown, data: unknown): Tx;
}
interface AppMod { initializeApp(cfg: FirebaseWebConfig): unknown }
interface AuthMod {
  getAuth(app: unknown): unknown;
  signInAnonymously(auth: unknown): Promise<unknown>;
}
interface FsMod {
  getFirestore(app: unknown): unknown;
  doc(db: unknown, ...path: string[]): unknown;
  collection(db: unknown, ...path: string[]): unknown;
  getDoc(ref: unknown): Promise<Snap>;
  onSnapshot(ref: unknown, next: (s: Snap & QuerySnap) => void, error: (e: unknown) => void): Unsub;
  runTransaction<T>(db: unknown, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

async function load<T>(file: string): Promise<T> {
  const url = `${SDK}/${file}`;
  return (await import(/* @vite-ignore */ url)) as T;
}

export class FirebaseStore implements RoomStore {
  readonly kind = 'firebase' as const;
  private fs!: FsMod;
  private db: unknown;

  constructor(private config: FirebaseWebConfig) {}

  async init() {
    const [app, auth, fs] = await Promise.all([
      load<AppMod>('firebase-app.js'),
      load<AuthMod>('firebase-auth.js'),
      load<FsMod>('firebase-firestore.js'),
    ]);
    const a = app.initializeApp(this.config);
    await auth.signInAnonymously(auth.getAuth(a));
    this.fs = fs;
    this.db = fs.getFirestore(a);
  }

  private roomRef(code: string) {
    return this.fs.doc(this.db, 'rooms', code);
  }
  private teamRef(code: string, id: string) {
    return this.fs.doc(this.db, 'rooms', code, 'teams', id);
  }

  async createRoom(room: Room) {
    const ref = this.roomRef(room.code);
    return this.fs.runTransaction(this.db, async (tx) => {
      if ((await tx.get(ref)).exists()) return false;
      tx.set(ref, sanitize(room));
      return true;
    });
  }

  async roomExists(code: string) {
    return (await this.fs.getDoc(this.roomRef(code))).exists();
  }

  subscribeRoom(code: string, cb: (room: Room | null) => void, onError?: (e: unknown) => void) {
    return this.fs.onSnapshot(this.roomRef(code), (s) => cb(s.exists() ? (s.data() as Room) : null), (e) => onError?.(e));
  }

  subscribeTeams(code: string, cb: (docs: TeamDoc[]) => void, onError?: (e: unknown) => void) {
    return this.fs.onSnapshot(
      this.fs.collection(this.db, 'rooms', code, 'teams'),
      (q) => cb(q.docs.map((d) => d.data() as TeamDoc)),
      (e) => onError?.(e),
    );
  }

  subscribeTeam(code: string, id: string, cb: (doc: TeamDoc | null) => void, onError?: (e: unknown) => void) {
    return this.fs.onSnapshot(this.teamRef(code, id), (s) => cb(s.exists() ? (s.data() as TeamDoc) : null), (e) => onError?.(e));
  }

  async updateRoom(code: string, fn: (room: Room) => Room | null) {
    const ref = this.roomRef(code);
    return this.fs.runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('방을 찾을 수 없어요.');
      const out = fn(snap.data() as Room);
      if (!out) return snap.data() as Room;
      const next = sanitize({ ...out, updatedAt: Date.now() });
      tx.set(ref, next);
      return next;
    });
  }

  async updateTeam(code: string, id: string, fn: (doc: TeamDoc | null, room: Room) => TeamDoc) {
    const rRef = this.roomRef(code);
    const tRef = this.teamRef(code, id);
    return this.fs.runTransaction(this.db, async (tx) => {
      const rs = await tx.get(rRef);
      if (!rs.exists()) throw new Error('방을 찾을 수 없어요.');
      const ts = await tx.get(tRef);
      const next = sanitize(fn(ts.exists() ? (ts.data() as TeamDoc) : null, rs.data() as Room));
      tx.set(tRef, next);
      return next;
    });
  }

  async updateRoomWithTeams(code: string, fn: (room: Room, docs: Record<string, TeamDoc | null>) => Room | null) {
    const rRef = this.roomRef(code);
    return this.fs.runTransaction(this.db, async (tx) => {
      const rs = await tx.get(rRef);
      if (!rs.exists()) throw new Error('방을 찾을 수 없어요.');
      const room = rs.data() as Room;
      const docs: Record<string, TeamDoc | null> = {};
      for (const t of room.teams) {
        const s = await tx.get(this.teamRef(code, t.id));
        docs[t.id] = s.exists() ? (s.data() as TeamDoc) : null;
      }
      const next = fn(room, docs);
      if (!next) return null;
      const clean = sanitize({ ...next, updatedAt: Date.now() });
      tx.set(rRef, clean);
      return clean;
    });
  }
}
