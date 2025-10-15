// Generated from svgs/IconBellFill.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconBellFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M15.145 14.236a.75.75 0 0 0 .605-.725c.012-.848-.407-1.531-.769-2.047q-.162-.23-.305-.424c-.263-.36-.474-.647-.614-.978-.04-.093-.062-.226-.062-.438V6c0-1.775-.556-3.292-1.632-4.368S9.775 0 8 0C6.226 0 4.708.556 3.632 1.632S2 4.225 2 6v3.624c0 .212-.022.345-.062.438-.14.33-.351.619-.614.978q-.143.194-.305.424c-.362.516-.781 1.2-.769 2.047a.75.75 0 0 0 .605.725h.004l.007.002.026.005a11 11 0 0 0 .461.077c.32.048.788.112 1.396.176.858.09 1.996.18 3.385.224a2 2 0 0 0 3.732 0 47 47 0 0 0 3.386-.224 31 31 0 0 0 1.76-.236l.096-.017.026-.005.007-.001z" /></svg>
	);
};

export { IconBellFill as ReactComponent };
