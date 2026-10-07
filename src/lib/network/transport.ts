import { Envelope } from "./protocol";

export type Network = "nostr" | "local";
export interface Transport {
  send: (message: Envelope) => Promise<void>;
  close: () => void;
}
export async function createTransport(
  roomId: string,
  secret: string,
  network: Network,
  receive: (message: unknown) => void,
  error: (message: string) => void,
): Promise<Transport> {
  if (network === "local") {
    const channel = new BroadcastChannel(`uno-v2:${roomId}:${secret}`);
    channel.onmessage = (event) => receive(event.data);
    return {
      send: async (message) => channel.postMessage(message),
      close: () => channel.close(),
    };
  }
  const { joinRoom } = await import("trystero");
  // Optional short-lived TURN settings may be supplied in the browser, never in an invite.
  let rtcConfig: RTCConfiguration | undefined;
  const saved = localStorage.getItem("uno-ice-servers-v1");
  if (saved) {
    try {
      rtcConfig = { iceServers: JSON.parse(saved) as RTCIceServer[] };
    } catch {
      error("Invalid saved ICE server configuration. Using default STUN.");
    }
  }
  const room = joinRoom(
    {
      appId: "ianwijma-uno-web-v2",
      password: secret,
      maxReceiveBytes: 256 * 1024,
      ...(rtcConfig ? { rtcConfig } : {}),
    },
    roomId,
    {
      onJoinError: () =>
        error(
          "A peer could not connect. Check your network or configure TURN.",
        ),
    },
  );
  const action = room.makeAction<Envelope>("protocol-v2");
  action.onMessage = (message) => receive(message);
  return {
    send: async (message) => {
      await action.send(message);
    },
    close: () => {
      void room.leave();
    },
  };
}
