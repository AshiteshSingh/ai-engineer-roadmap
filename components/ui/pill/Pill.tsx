import * as React from "react";
import { cx } from "../cx";
import styles from "./Pill.module.css";

export interface PillProps
  extends React.ComponentPropsWithoutRef<"button"> {
  /** Selected state (was `.yc-pill--active`). Also sets aria-pressed. */
  active?: boolean;
}

export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(
  ({ active = false, type = "button", className, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={cx(styles.pill, active && styles.active, className)}
      {...rest}
    />
  ),
);
Pill.displayName = "Pill";
