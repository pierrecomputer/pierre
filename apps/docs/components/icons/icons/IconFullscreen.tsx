// Generated from svgs/IconFullscreen.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconFullscreen = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6.97 7.97a.75.75 0 1 1 1.06 1.06L5.56 11.5h1.69a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75v-3.5a.75.75 0 0 1 1.5 0v1.69zM14.25 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V5.56l-2.47 2.47a.75.75 0 1 1-1.06-1.06l2.47-2.47h-1.69a.75.75 0 0 1 0-1.5z" /><path fillRule="evenodd" d="M15.25 0A2.75 2.75 0 0 1 18 2.75v10.5A2.75 2.75 0 0 1 15.25 16H2.75A2.75 2.75 0 0 1 0 13.25V2.75A2.75 2.75 0 0 1 2.75 0zM2.75 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V2.75c0-.69-.56-1.25-1.25-1.25z" clipRule="evenodd" /></svg>
	);
};

export { IconFullscreen as ReactComponent };
