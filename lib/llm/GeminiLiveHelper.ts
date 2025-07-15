import { GoogleGenAI, Modality } from '@google/genai'
import { GEMINI_SYSTEM_PROMPT } from './systemPrompt'
import { loadResumeText } from './contextLoader';

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY

if (!GEMINI_API_KEY) {
  throw new Error(
    'GEMINI_API_KEY is not set. Ensure it exists in .env or as a system env variable, or that it is defined in Vite env files.'
  )
}

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

interface LiveSession {
  sendRealtimeInput: (input: any) => void
  close: () => void
}

interface ChatChunk { text?: string; reset?: boolean }

export class GeminiLiveHelper {
  private session: LiveSession | null = null
  private readonly modelName = 'gemini-live-2.5-flash-preview'
  private closePending = false
  private turnJustCompleted = false

  // Start a new live session. If an old one is still open, close it first so we start fresh.
  async startSession(onMessage: (chunk: ChatChunk) => void): Promise<void> {
    if (this.session) {
      try {
        this.session.close();
      } catch (err) {
        console.warn('[GeminiLive] close previous session err', err);
      }
      this.session = null;
    }
    // If a session is already running, return early.
    // This check should be after closing potentially old sessions.
    if (this.session) return;

    // --- START OF MODIFICATIONS ---

    // 1. Load the resume text
    const resumeText = await loadResumeText();
    let systemInstruction = GEMINI_SYSTEM_PROMPT;

    // 2. Create a personalized system prompt if resume exists
    if (resumeText) {
      systemInstruction = `You MUST act as the person described in the resume below. Answer all questions in the first person ("I", "my", "we" when referring to a team I was on). Your identity is that of the person in the resume. Do not break character. Do not mention that you are an AI. Use the resume for context and background.\n\n--- RESUME ---\n${resumeText}\n\n--- END RESUME ---`;
    }

    let resolveConnection: () => void;
    let rejectConnection: (e: any) => void;
    const connectionPromise = new Promise<void>((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
    });

    const responseQueue: any[] = [];

    const waitMessage = async () => {
      while (responseQueue.length === 0) {
        await new Promise((res) => setTimeout(res, 50));
      }
      return responseQueue.shift();
    };

    const handleTurn = async () => {
      const turns: any[] = [];
      let done = false;
      while (!done) {
        const message = await waitMessage();
        turns.push(message);
        if (message?.serverContent?.turnComplete) {
          done = true;
        }
      }
      return turns;
    };

    this.session = (await genAI.live.connect({
      model: this.modelName,
      callbacks: {
        onopen: () => {
          console.warn('[GeminiLive] opened');
          resolveConnection(); // Resolve the promise when connection opens
        },
        onmessage: (m) => {
          responseQueue.push(m);
          const tText = (m as any).text;
          if (tText) {
            if (this.turnJustCompleted) {
              // This is the first chunk of a new turn.
              // Send a reset signal along with the text from this first chunk.
              onMessage({ reset: true, text: tText });
              this.turnJustCompleted = false;
            } else {
              // This is a subsequent chunk in the same turn.
              onMessage({ text: tText });
            }
          }
          if (m?.serverContent?.turnComplete) {
            this.turnJustCompleted = true;
          }
          if (m?.serverContent?.turnComplete && this.closePending && this.session) {
            this.session.close();
            this.session = null;
            this.closePending = false;
          }
        },
        onerror: (e) => {
          console.error('[GeminiLive] error', e);
          rejectConnection(e); // Reject the promise on error
        },
        onclose: (e) => console.warn('[GeminiLive] closed', e.reason),
      },
      config: { responseModalities: [Modality.TEXT], systemInstruction: systemInstruction},
    })) as unknown as LiveSession;

    // detach async listener to forward text
    (async () => {
      const turns = await handleTurn();
      for (const t of turns) {
        const text = (t as any).text;
        if (text) {
          onMessage({ text });
        }
      }
    })();

    return connectionPromise; // Return the promise that resolves on connection open
  }


  // Stream an audio chunk (called every ~250 ms)
  sendAudioChunk(chunk: Buffer): void {
    if (!this.session) return
    const base64Audio = chunk.toString('base64')
    this.session.sendRealtimeInput({
      audio: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' }
    })
  }

  /** Check whether a live session is currently active */
  isActive(): boolean {
    return !!this.session;
  }

  /** Return true if session is active and not pending close */
  canAcceptTextInput(): boolean {
    return !!this.session && !this.closePending;
  }

  /** Send plain text input during a live session */
  sendTextInput(text: string): void {
    if (!this.session) return;
    this.session.sendRealtimeInput({ text });
  }

  // Stream a JPEG image frame
  sendImageChunk(base64Jpeg: string): void {
    if (!this.session) return;

    this.session.sendRealtimeInput({ video: { data: base64Jpeg, mimeType: 'image/jpeg' } });
  }

  // Called when the mic button is toggled OFF
  finishTurn(): void {
    if (!this.session) return
    // Send explicit end-of-turn marker but keep socket open for reply
    this.session.sendRealtimeInput({ audioStreamEnd: true })
    this.closePending = true
  }

  endSession(): void {
    if (this.session) {
      try {
        this.session.close();
      } catch (err) {
        console.warn('[GeminiLive] error closing session:', err);
      }
      this.session = null;
    }
    this.closePending = false;
    this.turnJustCompleted = false;
  }
}
