import { createContext, useContext, useState } from 'react';

const MicContext = createContext(null);

export function MicProvider({ children }) {
  const [micOn, setMicOn] = useState(false);
  const toggleMic = () => setMicOn((v) => !v);
  return (
    <MicContext.Provider value={{ micOn, toggleMic }}>
      {children}
    </MicContext.Provider>
  );
}

export function useMic() {
  return useContext(MicContext);
}
