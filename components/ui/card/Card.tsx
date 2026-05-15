import * as React from "react";
import { cx } from "../cx";
import styles from "./Card.module.css";

export interface CardProps extends React.ComponentPropsWithoutRef<"div"> {
  /** Adds hover/focus elevation (was `.yc-card--interactive`). */
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ interactive = false, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cx(styles.card, interactive && styles.interactive, className)}
      {...rest}
    />
  ),
);
Card.displayName = "Card";
