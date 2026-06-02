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

  reset = () => {
    this.setState({ error: null });
    window.location.assign("/");
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
        </div>
      </div>
    );
  }
}
