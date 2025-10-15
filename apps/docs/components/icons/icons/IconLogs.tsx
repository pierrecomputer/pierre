// Generated from svgs/IconLogs.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconLogs = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.1875);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 19 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4.96 12a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zM10.46 12a.5.5 0 1 1 0 1h-3.5a.5.5 0 0 1 0-1zM15.46 12a.5.5 0 1 1 0 1h-.5a.5.5 0 0 1 0-1zM4.96 10a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zM11.46 10a.5.5 0 1 1 0 1h-4.5a.5.5 0 0 1 0-1zM15.46 10a.5.5 0 1 1 0 1h-.5a.5.5 0 0 1 0-1zM4.96 8a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zM12.46 8a.5.5 0 1 1 0 1h-5.5a.5.5 0 0 1 0-1zM15.46 8a.5.5 0 1 1 0 1h-.5a.5.5 0 0 1 0-1zM4.96 6a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zM12.46 6a.5.5 0 1 1 0 1h-5.5a.5.5 0 0 1 0-1zM15.46 6a.5.5 0 1 1 0 1h-.5a.5.5 0 0 1 0-1zM15.21 3a.75.75 0 0 1 0 1.5H4.71a.75.75 0 0 1 0-1.5z" /><path fillRule="evenodd" d="M16.21 0a2.75 2.75 0 0 1 2.75 2.75v10.5A2.75 2.75 0 0 1 16.21 16H3.71a2.75 2.75 0 0 1-2.75-2.75V2.75A2.75 2.75 0 0 1 3.71 0zM3.71 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V2.75c0-.69-.56-1.25-1.25-1.25z" clipRule="evenodd" /></svg>
	);
};

export { IconLogs as ReactComponent };
