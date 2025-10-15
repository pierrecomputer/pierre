// Generated from svgs/IconRefresh.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconRefresh = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.973 1.5C4.396 1.5 1.495 4.41 1.495 8a6.5 6.5 0 0 0 1.993 4.69v-1.94a.749.749 0 1 1 1.495 0v3.5c0 .414-.334.75-.747.75H.748A.75.75 0 0 1 0 14.25c0-.414.335-.75.748-.75h1.435A8 8 0 0 1 0 8c0-4.418 3.57-8 7.973-8 .413 0 .748.336.748.75s-.335.75-.748.75M11.729 6.018a.75.75 0 0 0 .747-.75V3.327A6.5 6.5 0 0 1 14.452 8c0 3.59-2.9 6.5-6.479 6.5a.75.75 0 0 0-.747.75c0 .414.335.75.747.75 4.404 0 7.974-3.582 7.974-8 0-2.14-.838-4.083-2.2-5.518h1.505a.75.75 0 0 0 .748-.75.75.75 0 0 0-.748-.75H11.73a.75.75 0 0 0-.748.75v3.536c0 .414.335.75.748.75" /></svg>
	);
};

export { IconRefresh as ReactComponent };
