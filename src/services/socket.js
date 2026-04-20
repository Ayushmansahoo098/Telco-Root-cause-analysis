import { io } from "socket.io-client";

export function createStateSocket({ onConnect, onDisconnect, onState }) {
  const socketUrl = import.meta.env.VITE_SOCKET_URL;

  if (!socketUrl) {
    return {
      enabled: false,
      connect() {},
      disconnect() {},
    };
  }

  const socket = io(socketUrl, {
    autoConnect: false,
    transports: ["websocket"],
  });

  socket.on("connect", () => {
    onConnect?.();
  });

  socket.on("disconnect", () => {
    onDisconnect?.();
  });

  socket.on("state:update", (payload) => {
    onState?.(payload);
  });

  return {
    enabled: true,
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
  };
}
