// Generated from svgs/IconHome2.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconHome2 = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 6c0-.828.172-1 1-1 .827 0 1 .172 1 1s-.173 1-1 1c-.828 0-1-.172-1-1" /><path fillRule="evenodd" d="M8.495.195a.75.75 0 0 1 1.01 0L13 3.373V2.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v2.691L16.99 7H17v.01l.754.685a.75.75 0 0 1-.766 1.258c-.03 1.103-.116 2.057-.295 2.872-.23 1.05-.623 1.916-1.288 2.58-.664.665-1.53 1.058-2.58 1.289C11.784 15.922 10.516 16 9 16s-2.784-.078-3.825-.306c-1.05-.23-1.916-.624-2.58-1.289s-1.058-1.53-1.289-2.58c-.179-.815-.265-1.769-.294-2.872a.75.75 0 0 1-.767-1.258L1 7.009V7h.01zM2.5 7.673V8c0 1.484.078 2.622.272 3.503.191.873.485 1.443.883 1.842.398.398.97.692 1.842.883.434.096.932.163 1.503.207V9.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v4.935c.57-.044 1.068-.111 1.503-.207.873-.191 1.443-.485 1.842-.883.398-.399.692-.97.883-1.842.194-.88.272-2.02.272-3.503v-.327L9 1.763z" clipRule="evenodd" /></svg>
	);
};

export { IconHome2 as ReactComponent };
