// Generated from svgs/IconQuestion.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconQuestion = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0m6.893-.578c-.791.621-1.067 1.014-1.067 1.705 0 .375.235.656.662.656.41 0 .563-.234.71-.58.134-.492.327-.697.896-1.13.75-.557 1.248-1.055 1.248-1.964C10.842 4.803 9.77 4 8.229 4c-.833 0-1.471.217-1.899.58-.351.31-.58.72-.58 1.108 0 .322.205.585.574.585.246 0 .387-.11.569-.351.28-.48.668-.697 1.23-.697.645 0 1.154.38 1.154.955 0 .515-.316.797-.884 1.242m-.405 3.193c-.486 0-.884.34-.884.826 0 .487.398.827.884.827.487 0 .89-.34.89-.827s-.403-.826-.89-.826" clipRule="evenodd" /></svg>
	);
};

export { IconQuestion as ReactComponent };
