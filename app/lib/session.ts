import type {HydrogenSession} from '@shopify/hydrogen';
import {
  createCookieSessionStorage,
  type SessionStorage,
  type Session,
} from 'react-router';

export class AppSession implements HydrogenSession {
  public isPending = false;

  #sessionStorage: SessionStorage;
  #session: Session;
  // Pre-created wrappers so that ACCESSING session.set/session.unset (e.g. via
  // destructuring inside Hydrogen's customer-account client) does not prematurely
  // set isPending = true. isPending is only set when the wrapper is actually called.
  #setFn: Session['set'];
  #unsetFn: Session['unset'];

  constructor(sessionStorage: SessionStorage, session: Session) {
    this.#sessionStorage = sessionStorage;
    this.#session = session;

    this.#setFn = (...args: Parameters<Session['set']>) => {
      this.isPending = true;
      return session.set(...args);
    };

    this.#unsetFn = (...args: Parameters<Session['unset']>) => {
      this.isPending = true;
      return session.unset(...args);
    };
  }

  static async init(request: Request, secrets: string[]) {
    const storage = createCookieSessionStorage({
      cookie: {
        name: 'session',
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secrets,
      },
    });

    const session = await storage
      .getSession(request.headers.get('Cookie'))
      .catch(() => storage.getSession());

    return new this(storage, session);
  }

  get has() {
    return this.#session.has;
  }

  get get() {
    return this.#session.get;
  }

  get flash() {
    return this.#session.flash;
  }

  get unset() {
    return this.#unsetFn;
  }

  get set() {
    return this.#setFn;
  }

  destroy() {
    return this.#sessionStorage.destroySession(this.#session);
  }

  commit() {
    this.isPending = false;
    return this.#sessionStorage.commitSession(this.#session);
  }
}
