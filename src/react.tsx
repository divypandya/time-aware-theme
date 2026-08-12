import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import type { ThemeController, ThemeControllerSnapshot } from './dom.js';

export interface TimeAwareThemeContextValue<
  TPhase extends string = string
> extends ThemeControllerSnapshot<TPhase> {
  readonly setMode: ThemeController<TPhase>['setMode'];
  readonly setPreviewMinute: ThemeController<TPhase>['setPreviewMinute'];
  readonly clearPreview: ThemeController<TPhase>['clearPreview'];
}

export interface TimeAwareThemeProviderProps<TPhase extends string = string> {
  readonly controller: ThemeController<TPhase>;
  readonly children: ReactNode;
}

const TimeAwareThemeContext = createContext<TimeAwareThemeContextValue | null>(
  null
);

export function TimeAwareThemeProvider<TPhase extends string = string>({
  controller,
  children
}: TimeAwareThemeProviderProps<TPhase>): React.ReactElement {
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  const value = useMemo<TimeAwareThemeContextValue<TPhase>>(
    () => ({
      ...snapshot,
      setMode: controller.setMode,
      setPreviewMinute: controller.setPreviewMinute,
      clearPreview: controller.clearPreview
    }),
    [controller, snapshot]
  );

  return (
    <TimeAwareThemeContext.Provider value={value}>
      {children}
    </TimeAwareThemeContext.Provider>
  );
}

export function useTimeAwareTheme<
  TPhase extends string = string
>(): TimeAwareThemeContextValue<TPhase> {
  const value = useContext(TimeAwareThemeContext);
  if (!value) {
    throw new Error(
      'useTimeAwareTheme() must be used within a TimeAwareThemeProvider.'
    );
  }
  return value as TimeAwareThemeContextValue<TPhase>;
}
