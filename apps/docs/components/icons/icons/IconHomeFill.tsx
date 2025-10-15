// Generated from svgs/IconHomeFill.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconHomeFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M13.5 2a.5.5 0 0 1 .5.5v2.622l1.75 1.57A.75.75 0 0 1 15 7.957V10c0 2.17-.296 3.815-1.523 4.825-.601.495-1.361.782-2.252.95q-.564.105-1.225.157A25 25 0 0 1 8 16q-1.095.002-2-.068l-.05-.004a12 12 0 0 1-1.175-.153c-.891-.168-1.65-.455-2.252-.95C1.296 13.815 1 12.17 1 10V7.957a.75.75 0 0 1-.808-.206.75.75 0 0 1 .057-1.06L7.5.192a.75.75 0 0 1 1.002 0L12 3.33V2.5a.5.5 0 0 1 .5-.5zM10 14.427V9.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4.927c.571.05 1.233.073 2 .073s1.429-.022 2-.073" clipRule="evenodd" /></svg>
	);
};

export { IconHomeFill as ReactComponent };
