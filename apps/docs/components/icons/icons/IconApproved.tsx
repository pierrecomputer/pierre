// Generated from svgs/IconApproved.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconApproved = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.5 8a6.5 6.5 0 0 1 8.294-6.25.75.75 0 1 0 .412-1.442 8 8 0 1 0 5.718 6.59.75.75 0 0 0-1.485.205q.06.44.061.897a6.5 6.5 0 1 1-13 0" /><path d="M15.076 2.48a.75.75 0 0 0-1.152-.96L7.783 8.889 5.03 6.136a.75.75 0 1 0-1.06 1.061l3.333 3.333a.75.75 0 0 0 1.106-.05z" /></svg>
	);
};

export { IconApproved as ReactComponent };
