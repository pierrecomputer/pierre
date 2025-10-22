// Generated from svgs/IconBin.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBin = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M5.75 7a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5z"/><path d="M1.25 1C.56 1 0 1.56 0 2.25v2.5c0 .605.43 1.11 1 1.225V8c0 1.304.069 2.403.27 3.31.204.917.553 1.684 1.145 2.275.591.592 1.358.94 2.274 1.144C5.597 14.931 6.696 15 8 15s2.403-.069 3.31-.27c.917-.204 1.684-.553 2.275-1.145.592-.591.94-1.358 1.144-2.274C14.931 10.403 15 9.304 15 8V5.975c.57-.116 1-.62 1-1.225v-2.5C16 1.56 15.44 1 14.75 1zM13.5 6v2c0 1.27-.069 2.239-.235 2.985-.164.738-.413 1.212-.74 1.54-.328.327-.802.576-1.54.74-.746.166-1.715.235-2.985.235s-2.239-.069-2.985-.235c-.738-.164-1.212-.413-1.54-.74-.327-.328-.576-.802-.74-1.54C2.569 10.24 2.5 9.27 2.5 8V6zm-12-1.5v-2h13v2z"/></svg>
	);
};

export { IconBin as ReactComponent };