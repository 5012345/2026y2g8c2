import type { Room, TeamDoc } from '../game/types';
import { sanitize, type RoomStore } from './store';

/**
 * 로컬 체험 모드: localStorage + BroadcastChannel.
 * 같은 기기·같은 브라우저의 여러 탭끼리만 연결됩니다. (Firebase 설정 전 체험·테스트용)
 */
export class LocalStore implements RoomStore {
  readonly kind = 'local' as const;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<(key: string) => void>();
  private memory = new Map<string, string>();

  async init() {
    try {
      this.channel = new BroadcastChannel('cant-stop-8-local');
      this.channel.onmessage = (e: MessageEvent<{ key: string }>) => this.emit(e.data.key);
    } catch {
      this.channel = null;
    }
  }

  private roomKey(code: string) {
    return `cant-stop8:room:${code}`;
  }
  private teamKey(code: string, id: string) {
    return `cant-stop8:team:${code}:${id}`;
  }

  private read<T>(key: string): T | null {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = this.memory.get(key) ?? null;
    }
    return raw ? (JSON.parse(raw) as T) : null;
  }

  private write(key: string, value: unknown) {
    const raw = JSON.stringify(sanitize(value));
    try {
      localStorage.setItem(key, raw);
    } catch {
      this.memory.set(key, raw);
    }
    this.channel?.postMessage({ key });
    this.emit(key);
  }

  private emit(key: string) {
    this.listeners.forEach((l) => l(key));
  }

  private listen(match: (key: string) => boolean, fire: () => void) {
    const l = (key: string) => {
      if (match(key)) fire();
    };
    this.listeners.add(l);
    queueMicrotask(fire);
    return () => {
      this.listeners.delete(l);
    };
  }

  private teamDocs(code: string): TeamDoc[] {
    const room = this.read<Room>(this.roomKey(code));
    if (!room) return [];
    return room.teams.map((t) => this.read<TeamDoc>(this.teamKey(code, t.id))).filter((d): d is TeamDoc => !!d);
  }

  async createRoom(room: Room) {
    if (this.read(this.roomKey(room.code))) return false;
    this.write(this.roomKey(room.code), room);
    return true;
  }

  async roomExists(code: string) {
    return this.read(this.roomKey(code)) !== null;
  }

  subscribeRoom(code: string, cb: (room: Room | null) => void) {
    const key = this.roomKey(code);
    return this.listen((k) => k === key, () => cb(this.read<Room>(key)));
  }

  subscribeTeams(code: string, cb: (docs: TeamDoc[]) => void) {
    const prefix = `cant-stop8:team:${code}:`;
    const roomKey = this.roomKey(code);
    return this.listen((k) => k.startsWith(prefix) || k === roomKey, () => cb(this.teamDocs(code)));
  }

  subscribeTeam(code: string, id: string, cb: (doc: TeamDoc | null) => void) {
    const key = this.teamKey(code, id);
    return this.listen((k) => k === key, () => cb(this.read<TeamDoc>(key)));
  }

  async updateRoom(code: string, fn: (room: Room) => Room | null) {
    const cur = this.read<Room>(this.roomKey(code));
    if (!cur) throw new Error('방을 찾을 수 없어요.');
    const out = fn(cur);
    if (!out) return cur;
    const next = sanitize({ ...out, updatedAt: Date.now() });
    this.write(this.roomKey(code), next);
    return next;
  }

  async updateTeam(code: string, id: string, fn: (doc: TeamDoc | null, room: Room) => TeamDoc) {
    const room = this.read<Room>(this.roomKey(code));
    if (!room) throw new Error('방을 찾을 수 없어요.');
    const next = sanitize(fn(this.read<TeamDoc>(this.teamKey(code, id)), room));
    this.write(this.teamKey(code, id), next);
    return next;
  }

  async updateRoomWithTeams(code: string, fn: (room: Room, docs: Record<string, TeamDoc | null>) => Room | null) {
    const room = this.read<Room>(this.roomKey(code));
    if (!room) throw new Error('방을 찾을 수 없어요.');
    const docs: Record<string, TeamDoc | null> = {};
    for (const t of room.teams) docs[t.id] = this.read<TeamDoc>(this.teamKey(code, t.id));
    const next = fn(room, docs);
    if (!next) return null;
    const clean = sanitize({ ...next, updatedAt: Date.now() });
    this.write(this.roomKey(code), clean);
    return clean;
  }
}
