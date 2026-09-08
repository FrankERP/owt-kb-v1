// The one place motion's feature set is chosen (ADR-0031). `domMax` = domAnimation +
// layout projection + drag: layout is what M0b-2's sliding indicators (`layoutId`) need;
// drag is included because the two are one bundle in motion 13 (there is no public
// `layout`-only set). Loaded as an async chunk by MotionProvider; measured in
// docs/MOTION.md against the 40 kB gz line from the spec's Part VI.
export { domMax as default } from "motion/react";
