import {Component, type ErrorInfo, type ReactNode} from "react";
import {AlertTriangle, RefreshCw} from "lucide-react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {hasError: false};

  static getDerivedStateFromError() {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Nexora UI error", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-void px-4 py-10 text-slate-100">
          <div className="mx-auto max-w-2xl rounded-lg border border-white/[0.08] bg-white/[0.04] p-6">
            <div className="flex items-center gap-3 text-white">
              <AlertTriangle size={20} className="text-cyan" />
              <h1 className="text-lg font-semibold">Something stopped the app</h1>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Nexora could not display this page. Reload the app and try again. If the problem continues, try again later.
            </p>
            <button onClick={() => window.location.reload()} className="action-button mt-5">
              <RefreshCw size={16} />
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
