// Generated from svgs/IconInProgress.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconInProgress = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M13.25 8a5.25 5.25 0 0 1-4.75 5.227.466.466 0 0 1-.5-.477v-9.5c0-.276.224-.502.5-.477.591.056 1.154.21 1.672.446a5.26 5.26 0 0 1 2.876 3.333c.131.46.202.946.202 1.448" /><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0" /></svg>
	);
};

export { IconInProgress as ReactComponent };
