// Generated from svgs/IconBinFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBinFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M0 2.25C0 1.56.56 1 1.25 1h13.5c.69 0 1.25.56 1.25 1.25v.5C16 3.44 15.44 4 14.75 4H1.25C.56 4 0 3.44 0 2.75z"/><path d="M1 5h14v3c0 1.304-.069 2.403-.27 3.31-.204.917-.553 1.684-1.145 2.275-.591.592-1.358.94-2.274 1.144C10.403 14.931 9.304 15 8 15s-2.403-.069-3.31-.27c-.917-.204-1.684-.553-2.275-1.145-.592-.591-.94-1.358-1.144-2.274C1.069 10.403 1 9.304 1 8zm4 2.75A.75.75 0 0 1 5.75 7h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 7.75" clip-rule="evenodd"/></svg>
	);
};

export { IconBinFill as ReactComponent };