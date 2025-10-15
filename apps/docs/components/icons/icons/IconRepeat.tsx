// Generated from svgs/IconRepeat.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconRepeat = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M10.72.22a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H4.25A1.75 1.75 0 0 0 2.5 6.25v.625a.75.75 0 0 1-1.5 0V6.25A3.25 3.25 0 0 1 4.25 3h8.19l-1.72-1.72a.75.75 0 0 1 0-1.06m-5.44 8.5a.75.75 0 0 1 0 1.06L3.56 11.5h8.19a1.75 1.75 0 0 0 1.75-1.75v-.625a.75.75 0 0 1 1.5 0v.625A3.25 3.25 0 0 1 11.75 13H3.56l1.72 1.72a.75.75 0 1 1-1.06 1.06l-3-3a.75.75 0 0 1 0-1.06l3-3a.75.75 0 0 1 1.06 0" clipRule="evenodd" /></svg>
	);
};

export { IconRepeat as ReactComponent };
