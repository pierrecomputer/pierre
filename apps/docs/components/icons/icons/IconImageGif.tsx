// Generated from svgs/IconImageGif.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconImageGif = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.5 3.75c0-.69.56-1.25 1.25-1.25h2.625a.75.75 0 0 0 0-1.5H2.75A2.75 2.75 0 0 0 0 3.75v2.125a.75.75 0 0 0 1.5 0zM10.625 1a.75.75 0 0 0 0 1.5h2.625c.69 0 1.25.56 1.25 1.25v2.125a.75.75 0 0 0 1.5 0V3.75A2.75 2.75 0 0 0 13.25 1zM16 10.125a.75.75 0 0 0-1.5 0v2.125c0 .69-.56 1.25-1.25 1.25h-2.625a.75.75 0 0 0 0 1.5h2.625A2.75 2.75 0 0 0 16 12.25zM1.5 10.125a.75.75 0 0 0-1.5 0v2.125A2.75 2.75 0 0 0 2.75 15h2.625a.75.75 0 0 0 0-1.5H2.75c-.69 0-1.25-.56-1.25-1.25zM11.5 7.999c0 1.132-4.735 3.602-5.458 3.21-.723-.393-.723-6.042 0-6.42C6.765 4.412 11.5 6.866 11.5 8" /></svg>
	);
};

export { IconImageGif as ReactComponent };
