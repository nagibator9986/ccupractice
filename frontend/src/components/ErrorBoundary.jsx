import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("UI crash captured by ErrorBoundary:", error, info);
  }

  // "На главную": drop the cached user (a poisoned ccu_user is the most common
  // persisted-state crash source) but keep the token so AuthContext refetches a
  // fresh /me on reload. The full-page navigation discards the broken tree.
  reset = () => {
    try {
      localStorage.removeItem("ccu_user");
    } catch {
      /* ignore */
    }
    window.location.assign("/");
  };

  // Escape hatch for a crash that reproduces on "/" (e.g. a poisoned token):
  // clear both creds and go to /login, whose render path doesn't depend on them.
  hardReset = () => {
    try {
      localStorage.removeItem("ccu_user");
      localStorage.removeItem("ccu_token");
    } catch {
      /* ignore */
    }
    window.location.assign("/login");
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-coral-50 via-white to-charcoal-50">
        <div className="card p-8 max-w-md text-center">
          <img src="/ccu-logo.png" alt="" className="h-16 w-16 mx-auto mb-4 opacity-90" />
          <h1 className="font-serif text-2xl font-bold mb-2">Что-то пошло не так</h1>
          <p className="text-sm text-charcoal-500 mb-4">
            Произошла непредвиденная ошибка в интерфейсе. Можно вернуться на главную и попробовать снова.
          </p>
          <details className="text-left text-[11px] font-mono text-charcoal-500 bg-charcoal-50 p-3 rounded-xl mb-4">
            <summary className="cursor-pointer text-charcoal-700 font-semibold">Технические детали</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>
          <button className="btn-primary w-full" onClick={this.reset}>
            На главную
          </button>
          <button className="btn-secondary w-full mt-2" onClick={this.hardReset}>
            Выйти и очистить сессию
          </button>
        </div>
      </div>
    );
  }
}
