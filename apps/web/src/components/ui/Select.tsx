'use client';

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';
import { buttonClassName } from './buttonStyles';
import { AnchoredPopover } from './TableFilterControl';

const TYPEAHEAD_MS = 500;

export type SelectVariant = 'field' | 'button';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /**
   * `field` matches neighbouring inputs. `button` matches a secondary
   * button (the alert test-type picker sits on an action row).
   */
  variant?: SelectVariant;
};

type ParsedOption = {
  value: string;
  label: string;
  disabled: boolean;
  key: string;
};

type ParsedBlock =
  | { kind: 'option'; option: ParsedOption }
  | { kind: 'group'; label: string; options: ParsedOption[] };

function textFromNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textFromNode(props.children);
  }
  return '';
}

function parseBlocks(children: ReactNode): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let index = 0;

  function parseOption(element: ReactElement): ParsedOption | null {
    if (element.type !== 'option') return null;
    const props = element.props as OptionHTMLAttributes<HTMLOptionElement>;
    const labelText = textFromNode(props.children).replace(/\s+/g, ' ').trim();
    const value = props.value == null ? labelText : String(props.value);
    const option: ParsedOption = {
      value,
      label: labelText || value,
      disabled: Boolean(props.disabled),
      key: `${index}:${value}`,
    };
    index += 1;
    return option;
  }

  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        visit((child.props as { children?: ReactNode }).children);
        return;
      }
      if (child.type === 'optgroup') {
        const props = child.props as { label?: string; children?: ReactNode };
        const options: ParsedOption[] = [];
        Children.forEach(props.children, (option) => {
          if (!isValidElement(option) || option.type !== 'option') return;
          const parsed = parseOption(option);
          if (parsed) options.push(parsed);
        });
        blocks.push({
          kind: 'group',
          label: String(props.label ?? ''),
          options,
        });
        return;
      }
      const parsed = parseOption(child);
      if (parsed) blocks.push({ kind: 'option', option: parsed });
    });
  }

  visit(children);
  return blocks;
}

function flatten(blocks: ParsedBlock[]): ParsedOption[] {
  return blocks.flatMap((block) => (block.kind === 'option' ? [block.option] : block.options));
}

function stringify(value: string | number | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

function isMultiRow(size: SelectProps['size']): boolean {
  if (typeof size !== 'number') return false;
  return Number.isFinite(size) && size > 1;
}

function firstEnabled(options: ParsedOption[]): number {
  const index = options.findIndex((option) => !option.disabled);
  return index >= 0 ? index : 0;
}

function lastEnabled(options: ParsedOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return 0;
}

function moveEnabled(options: ParsedOption[], index: number, direction: 1 | -1): number {
  let cursor = index;
  for (let step = 0; step < options.length; step += 1) {
    cursor += direction;
    if (cursor < 0 || cursor >= options.length) return index;
    if (!options[cursor]?.disabled) return cursor;
  }
  return index;
}

function matchByPrefix(options: ParsedOption[], query: string, from: number): number {
  const needle = query.toLocaleLowerCase();
  if (!needle || options.length === 0) return -1;
  const start = ((from % options.length) + options.length) % options.length;
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (start + offset) % options.length;
    const option = options[index];
    if (!option || option.disabled) continue;
    if (option.label.toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

function optionDomId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

function scrollOptionIntoMenu(option: HTMLElement) {
  const menu = option.closest('.kh-ops-select-menu');
  if (!(menu instanceof HTMLElement)) return;
  const optionRect = option.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  if (optionRect.bottom > menuRect.bottom) {
    menu.scrollTop += optionRect.bottom - menuRect.bottom;
  } else if (optionRect.top < menuRect.top) {
    menu.scrollTop -= menuRect.top - optionRect.top;
  }
}

function dataAttributes(
  props: SelectHTMLAttributes<HTMLSelectElement>,
): SelectHTMLAttributes<HTMLButtonElement> {
  const data: SelectHTMLAttributes<HTMLButtonElement> = {};
  for (const [key, propValue] of Object.entries(props)) {
    if (!key.startsWith('data-')) continue;
    if (
      typeof propValue === 'string' ||
      typeof propValue === 'number' ||
      typeof propValue === 'boolean'
    ) {
      (data as Record<string, string | number | boolean>)[key] = propValue;
    }
  }
  return data;
}

/**
 * Dropdown that paints its own listbox. Firefox ignores author CSS on the
 * native popup, so the selected row had no frame there while Edge showed one.
 * The hidden select still carries name, value, required, and disabled.
 */
export function Select(props: SelectProps) {
  if (props.multiple || isMultiRow(props.size)) {
    const { variant: _variant, className, children, ...native } = props;
    return (
      <select className={cn('kh-input', className)} {...native}>
        {children}
      </select>
    );
  }
  return <ListboxSelect {...props} />;
}

function ListboxSelect({
  className,
  children,
  value,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  name,
  required,
  disabled,
  id,
  form,
  autoFocus,
  autoComplete,
  variant = 'field',
  tabIndex,
  title,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: SelectProps) {
  const popoverId = useId();
  const listboxId = useId();
  const valueId = `${listboxId}-value`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const blocks = parseBlocks(children);
  const options = flatten(blocks);
  const fallback = options.find((option) => !option.disabled)?.value ?? options[0]?.value ?? '';
  const isControlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState<string | null>(() =>
    defaultValue !== undefined ? stringify(defaultValue) : null,
  );
  const selected = isControlled ? stringify(value) : (uncontrolled ?? fallback);
  const current = options.find((option) => option.value === selected);
  const currentLabel = current?.label ?? selected;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fieldLabel, setFieldLabel] = useState('');
  const bufferRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  const activeRef = useRef(activeIndex);
  const selectedRef = useRef(selected);
  optionsRef.current = options;
  activeRef.current = activeIndex;
  selectedRef.current = selected;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    bufferRef.current = '';
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const commitRef = useRef<(next: string) => void>(() => undefined);
  commitRef.current = (next: string) => {
    const option = optionsRef.current.find((item) => item.value === next);
    if (!option || option.disabled) {
      close(true);
      return;
    }
    const changed = next !== selectedRef.current;
    if (!isControlled && changed) setUncontrolled(next);
    const select = nativeRef.current;
    if (select && changed) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, next);
      onChange?.({
        target: select,
        currentTarget: select,
      } as ChangeEvent<HTMLSelectElement>);
    }
    close(true);
  };

  useLayoutEffect(() => {
    if (ariaLabel) return;
    const button = triggerRef.current;
    if (!button) return;
    const wrapping = button.closest('label')?.querySelector(':scope > span') ?? null;
    let source: Element | null = wrapping;
    if (!source && button.id && typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      source = document.querySelector(`label[for="${CSS.escape(button.id)}"]`);
    }
    const text = source?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    setFieldLabel((currentText) => (currentText === text ? currentText : text));
  }, [ariaLabel, currentLabel, open, id]);

  useEffect(() => {
    if (isControlled) return undefined;
    const form = nativeRef.current?.form;
    if (!form) return undefined;
    const initial = defaultValue !== undefined ? stringify(defaultValue) : null;
    function onReset() {
      setUncontrolled(initial);
    }
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [defaultValue, isControlled]);

  useEffect(() => {
    if (!open) return;
    const node = document.getElementById(optionDomId(listboxId, activeIndex));
    if (!(node instanceof HTMLElement)) return;
    if (document.activeElement !== node) node.focus({ preventScroll: true });
    scrollOptionIntoMenu(node);
  }, [activeIndex, listboxId, open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: globalThis.KeyboardEvent) {
      const menu = document.getElementById(popoverId);
      const target = event.target;
      const inMenu = target instanceof Node && Boolean(menu?.contains(target));
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
        return;
      }
      if (!inMenu) return;
      const list = optionsRef.current;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveIndex(moveEnabled(list, activeRef.current, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveIndex(moveEnabled(list, activeRef.current, -1));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveIndex(firstEnabled(list));
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveIndex(lastEnabled(list));
        return;
      }
      if (event.key === 'Enter' || (event.key === ' ' && bufferRef.current.length === 0)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const option = list[activeRef.current];
        if (option) commitRef.current(option.value);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
      event.preventDefault();
      const continued = bufferRef.current.length > 0;
      const query = `${bufferRef.current}${event.key}`;
      const from = continued ? activeRef.current : activeRef.current + 1;
      const match = matchByPrefix(list, query, from);
      bufferRef.current = query;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        bufferRef.current = '';
      }, TYPEAHEAD_MS);
      if (match >= 0) setActiveIndex(match);
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [close, open, popoverId]);

  const selectedIndex = (() => {
    const match = options.findIndex((option) => option.value === selected && !option.disabled);
    return match >= 0 ? match : firstEnabled(options);
  })();

  function rememberTypeahead(query: string) {
    bufferRef.current = query;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      bufferRef.current = '';
    }, TYPEAHEAD_MS);
  }

  function openAt(index: number, keepBuffer = false) {
    if (disabled || options.length === 0) return;
    if (!keepBuffer) bufferRef.current = '';
    setActiveIndex(index);
    setOpen(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event as unknown as KeyboardEvent<HTMLSelectElement>);
    if (event.defaultPrevented || disabled) return;
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter' ||
      event.key === ' ' ||
      (event.altKey && event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      openAt(selectedIndex);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      openAt(firstEnabled(options));
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      openAt(lastEnabled(options));
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
    event.preventDefault();
    const match = matchByPrefix(options, event.key, selectedIndex + 1);
    rememberTypeahead(event.key);
    openAt(match >= 0 ? match : selectedIndex, true);
  }

  const purpose = ariaLabel || fieldLabel;
  const announced = purpose ? `${purpose}, ${currentLabel}` : undefined;
  const listLabel = purpose || currentLabel || 'Options';
  let cursor = 0;
  const rows = blocks.map((block, blockIndex) => {
    if (block.kind === 'option') {
      const index = cursor;
      cursor += 1;
      return renderOption(block.option, index);
    }
    const groupOptions = block.options.map((option) => {
      const index = cursor;
      cursor += 1;
      return renderOption(option, index);
    });
    return (
      <div key={`group-${blockIndex}`} role="group" aria-label={block.label || undefined}>
        {block.label ? (
          <div className="kh-select-group-label" aria-hidden="true">
            {block.label}
          </div>
        ) : null}
        {groupOptions}
      </div>
    );
  });

  function renderOption(option: ParsedOption, index: number) {
    const isSelected = option.value === selected;
    const active = index === activeIndex;
    return (
      <button
        key={option.key}
        id={optionDomId(listboxId, index)}
        type="button"
        role="option"
        className="kh-ops-choice"
        aria-selected={isSelected}
        disabled={option.disabled}
        tabIndex={active ? 0 : -1}
        data-active={active ? 'true' : undefined}
        onClick={() => commitRef.current(option.value)}
      >
        {option.label}
      </button>
    );
  }

  const triggerClass =
    variant === 'button'
      ? cn(buttonClassName('secondary'), 'kh-select-trigger', 'kh-select-trigger-button', className)
      : cn('kh-input', 'kh-select-trigger', className);

  return (
    <span className={cn('kh-select', variant === 'button' && 'kh-select-button')}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={triggerClass}
        disabled={disabled}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabelledBy ? undefined : announced}
        aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        onClick={() => {
          if (open) close(false);
          else openAt(selectedIndex);
        }}
        onKeyDown={handleTriggerKeyDown}
        onFocus={(event) => {
          onFocus?.(event as unknown as FocusEvent<HTMLSelectElement>);
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          const menu = document.getElementById(popoverId);
          if (next instanceof Node && menu?.contains(next)) return;
          onBlur?.(event as unknown as FocusEvent<HTMLSelectElement>);
        }}
        {...dataAttributes(rest)}
      >
        <span id={valueId} className="kh-select-value">
          {currentLabel}
        </span>
      </button>
      <select
        ref={nativeRef}
        className="kh-select-native"
        name={name}
        form={form}
        value={selected}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        tabIndex={-1}
        aria-hidden="true"
        onChange={() => undefined}
        onFocus={() => triggerRef.current?.focus()}
      >
        {children}
      </select>
      {open && triggerRef.current ? (
        <AnchoredPopover
          id={popoverId}
          anchor={triggerRef.current}
          label={listLabel}
          className="kh-ops-select-menu"
          initialFocus="[data-active='true']"
          onClose={close}
        >
          <div role="listbox" id={listboxId} aria-label={listLabel}>
            {rows}
          </div>
        </AnchoredPopover>
      ) : null}
    </span>
  );
}
