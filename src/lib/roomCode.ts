export async function fetchNewRoomCode(): Promise<string> {
  const res = await fetch("/api/new-room");
  if (!res.ok) throw new Error(`failed to allocate room code: ${res.status}`);
  const data = (await res.json()) as { roomCode: string };
  return data.roomCode;
}
