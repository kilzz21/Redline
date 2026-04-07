import { createContext, useContext, useRef, useState } from 'react';

const MicContext = createContext(null);

export function MicProvider({ children }) {
  const [micOn, setMicOn] = useState(false);
  const [channelName, setChannelName] = useState(null);
  // RadioScreen registers a callback here so MicBar can trigger real Agora mute
  const muteCallbackRef = useRef(null);

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    muteCallbackRef.current?.(next);
  };

  return (
    <MicContext.Provider value={{ micOn, setMicOn, channelName, setChannelName, toggleMic, muteCallbackRef }}>
      {children}
    </MicContext.Provider>
  );
}

export function useMic() {
  return useContext(MicContext);
}
