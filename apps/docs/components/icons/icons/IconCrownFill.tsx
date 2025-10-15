// Generated from svgs/IconCrownFill.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCrownFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M9 0a1.5 1.5 0 0 1 .983 2.63l2.49 3.773 2.547-1.66a1.5 1.5 0 1 1 1.515 1.255l-.593 2.52a8 8 0 0 0-.185 1.256l-.026.436c-.083 2.044-.47 3.603-1.648 4.586C12.94 15.75 11.233 16 9 16s-3.94-.25-5.083-1.204c-1.177-.983-1.565-2.542-1.648-4.586a9 9 0 0 0-.211-1.692l-.594-2.52A1.499 1.499 0 0 1 1.5 3a1.5 1.5 0 0 1 1.479 1.743l2.546 1.66 2.49-3.774A1.5 1.5 0 0 1 9 0m0 7.25a.75.75 0 0 0-.617.324l-.054.091-1 2a.75.75 0 0 0 0 .67l1 2 .054.09a.75.75 0 0 0 1.288-.09l1-2a.75.75 0 0 0 .034-.59l-.034-.08-1-2A.75.75 0 0 0 9 7.25" clipRule="evenodd" /></svg>
	);
};

export { IconCrownFill as ReactComponent };
