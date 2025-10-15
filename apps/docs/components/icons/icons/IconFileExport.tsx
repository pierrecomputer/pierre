// Generated from svgs/IconFileExport.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconFileExport = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.0625);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M10.31 0c.199 0 .39.08.53.22l3.5 3.5c.14.14.22.331.22.53v1.879l-.015-.013a2.73 2.73 0 0 0-1.485-.602V5h-1.75a1.75 1.75 0 0 1-1.75-1.75V1.5H5.31c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h4.762c.05.537.255 1.061.618 1.5H5.31a2.75 2.75 0 0 1-2.75-2.75V2.75A2.75 2.75 0 0 1 5.31 0z" /><path d="M12.28 7.72a.75.75 0 0 0 0 1.06l1.719 1.72h-5.44V12H14l-1.72 1.72a.75.75 0 1 0 1.061 1.06l3-3a.75.75 0 0 0 0-1.06l-3-3a.75.75 0 0 0-1.06 0" /></svg>
	);
};

export { IconFileExport as ReactComponent };
