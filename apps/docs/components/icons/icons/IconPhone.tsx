// Generated from svgs/IconPhone.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPhone = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6 12a.5.5 0 0 0-.5.5v.5a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-.5a.5.5 0 0 0-.5-.5z" /><path fillRule="evenodd" d="M5.25 0A2.25 2.25 0 0 0 3 2.25v11.5A2.25 2.25 0 0 0 5.25 16h5.5A2.25 2.25 0 0 0 13 13.75V2.25A2.25 2.25 0 0 0 10.75 0zM4.5 2.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 .75.75v11.5a.75.75 0 0 1-.75.75h-5.5a.75.75 0 0 1-.75-.75z" clipRule="evenodd" /></svg>
	);
};

export { IconPhone as ReactComponent };
