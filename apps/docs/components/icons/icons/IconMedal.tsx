// Generated from svgs/IconMedal.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconMedal = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><g clip-path="url(#a)"><path d="M8 4a6 6 0 1 1 0 12A6 6 0 0 1 8 4m.416 3.27a.456.456 0 0 0-.832 0l-.67 1.421-1.516.23a.485.485 0 0 0-.257.817l1.1 1.125-.258 1.577a.49.49 0 0 0 .198.477.45.45 0 0 0 .477.026L8 12.203l1.342.74c.164.09.346.066.477-.026a.49.49 0 0 0 .198-.477l-.258-1.577 1.1-1.125a.485.485 0 0 0-.257-.816l-1.516-.23z" clip-rule="evenodd"/><path d="M5.646 0a1 1 0 0 1 .882.553l.507 1.043c.325.65-.127 1.451-.83 1.637a7 7 0 0 0-1.28.477c-.552.27-1.254.103-1.53-.447l-.907-1.816A1 1 0 0 1 3.396 0zm6.959 0a1 1 0 0 1 .894 1.447l-.895 1.816c-.275.55-.978.719-1.53.448a7 7 0 0 0-1.28-.478c-.703-.186-1.164-.966-.839-1.617L9.474.553A1 1 0 0 1 10.368 0z"/></g><defs><clipPath id="a"><path d="M0 0h16v16H0z"/></clipPath></defs></svg>
	);
};

export { IconMedal as ReactComponent };