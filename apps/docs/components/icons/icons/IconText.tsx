// Generated from svgs/IconText.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconText = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="m14.87 0 .133 4.63h-.787q-.222-1.262-.643-1.905-.42-.654-1.263-.898-.831-.243-2.304-.31l-.553-.022V13.63q0 .543.133.842.144.299.565.454.42.144 1.296.233V16H4.555v-.842q.886-.09 1.308-.233.42-.155.543-.454.133-.3.133-.842V1.495l-.542.022q-1.473.067-2.304.31-.831.244-1.253.887-.42.642-.653 1.917H1L1.144 0z" /></svg>
	);
};

export { IconText as ReactComponent };
