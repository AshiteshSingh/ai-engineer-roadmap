import * as React from "react";
import { cx } from "../cx";
import styles from "./Stat.module.css";

export interface StatProps
  extends React.ComponentPropsWithoutRef<"div"> {
  value: React.ReactNode;
  label: React.ReactNode;
}

export const Stat = React.forwardRef<HTMLDivElement, StatProps>(
  ({ value, label, className, ...rest }, ref) => (
    <div ref={ref} className={cx(styles.stat, className)} {...rest}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
    </div>
  ),
);
Stat.displayName = "Stat";
