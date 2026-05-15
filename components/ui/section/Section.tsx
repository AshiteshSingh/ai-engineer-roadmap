import * as React from "react";
import { cx } from "../cx";
import styles from "./Section.module.css";

export interface SectionProps
  extends React.ComponentPropsWithoutRef<"div"> {
  /** Reduced vertical rhythm (was `.yc-section--tight`). */
  tight?: boolean;
}

export const Section = React.forwardRef<HTMLDivElement, SectionProps>(
  ({ tight = false, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cx(styles.section, tight && styles.tight, className)}
      {...rest}
    />
  ),
);
Section.displayName = "Section";
