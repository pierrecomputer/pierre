// Generated from svgs/IconPin.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPin = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path stroke="#000" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m14.803 5.656-.102.103a1.75 1.75 0 0 1-.894.478l-.58.117a2.25 2.25 0 0 0-1.15.615l-1.963 1.963c-.335.334-.441.818-.36 1.258.062.341.11.785.06 1.22-.04.349-.141.677-.331.947L6.848 9.724a.75.75 0 0 0-.491-.217.74.74 0 0 0-.216-.49L3.506 6.38c.27-.19.599-.292.947-.331.436-.05.88-.002 1.22.06.441.081.925-.026 1.259-.36l1.963-1.963c.314-.314.528-.715.615-1.15l.116-.58a1.75 1.75 0 0 1 .479-.894l.101-.102z"/></svg>
	);
};

export { IconPin as ReactComponent };