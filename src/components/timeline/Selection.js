/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import clamp from 'clamp';
import { getContentRect } from 'firefox-profiler/utils/css-geometry-tools';
import {
  getPreviewSelection,
  getCommittedRange,
  getZeroAt,
} from 'firefox-profiler/selectors/profile';
import {
  updatePreviewSelection,
  commitRange,
} from 'firefox-profiler/actions/profile-view';
import explicitConnect from 'firefox-profiler/utils/connect';
import classNames from 'classnames';
import { Draggable } from 'firefox-profiler/components/shared/Draggable';
import { getFormattedTimeLength } from 'firefox-profiler/profile-logic/committed-ranges';
import './Selection.css';

import type {
  Milliseconds,
  CssPixels,
  StartEndRange,
  PreviewSelection,
} from 'firefox-profiler/types';

import type { ConnectedProps } from 'firefox-profiler/utils/connect';

type PointerHandler = (event: PointerEvent) => void;

type OwnProps = {|
  +width: number,
  +children: React.Node,
  +className?: string,
|};

type StateProps = {|
  +previewSelection: PreviewSelection,
  +committedRange: StartEndRange,
  +zeroAt: Milliseconds,
|};

type DispatchProps = {|
  +commitRange: typeof commitRange,
  +updatePreviewSelection: typeof updatePreviewSelection,
|};

type Props = ConnectedProps<OwnProps, StateProps, DispatchProps>;

type State = {|
  hoverLocation: null | CssPixels,
|};

class TimelineRulerAndSelection extends React.PureComponent<Props, State> {
  _handlers: ?{|
    pointerStartHandler: PointerHandler,
    pointerMoveHandler: PointerHandler,
    pointerEndHandler: PointerHandler,
  |};

  _container: ?HTMLElement;

  state = {
    hoverLocation: null,
  };

  _containerCreated = (element: HTMLElement | null) => {
    this._container = element;
  };

  _onPointerDown = (event: SyntheticPointerEvent<>) => {
    if (!event.isPrimary) {
      return; // this is not the primary pointer (e.g. the second finger on a touch device)
    }
    if (
      !this._container ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      // Do not start a selection if the user doesn't press with the left button
      // or if they uses a keyboard modifier. Especially on MacOS ctrl+click can
      // be used to display the context menu.
      return;
    }

    const rect = getContentRect(this._container);
    if (
      event.pageX < rect.left ||
      event.pageX >= rect.right ||
      event.pageY < rect.top ||
      event.pageY >= rect.bottom
    ) {
      return;
    }

    // Don't steal focus. The -moz-user-focus: ignore declaration achieves
    // this more reliably in Gecko, so this preventDefault is mostly for other
    // browsers.
    event.preventDefault();

    const { committedRange } = this.props;
    const minSelectionStartWidth: CssPixels = 3;
    const mouseDownX = event.pageX;
    const mouseDownTime =
      ((mouseDownX - rect.left) / rect.width) *
        (committedRange.end - committedRange.start) +
      committedRange.start;

    let isRangeSelecting = false;

    const getSelectionFromEvent = (event: PointerEvent) => {
      const mouseMoveX = event.pageX;
      const mouseMoveTime =
        ((mouseMoveX - rect.left) / rect.width) *
          (committedRange.end - committedRange.start) +
        committedRange.start;
      const selectionStart = clamp(
        Math.min(mouseDownTime, mouseMoveTime),
        committedRange.start,
        committedRange.end
      );
      const selectionEnd = clamp(
        Math.max(mouseDownTime, mouseMoveTime),
        committedRange.start,
        committedRange.end
      );
      return { selectionStart, selectionEnd };
    };

    const pointerMoveHandler = (event: PointerEvent) => {
      if (!event.isPrimary) {
        return;
      }
      // from MDN regarding event.buttons, it is 1 if: Left Mouse, Touch Contact, Pen contact
      const isLeftButtonUsed = (event.buttons & 1) > 0;
      if (!isLeftButtonUsed) {
        // Oops, the mouseMove handler is still registered but the left button
        // isn't pressed, this means we missed the "click" event for some reason.
        // Maybe the user moved the cursor in some place where we didn't get the
        // click event because of Firefox issues such as bug 1755746 and bug 1755498.
        // Let's uninstall the event handlers and stop the selection.
        const { previewSelection } = this.props;
        isRangeSelecting = false;
        this._uninstallMoveAndClickHandlers();

        if (previewSelection.hasSelection) {
          const { selectionStart, selectionEnd } = previewSelection;
          this.props.updatePreviewSelection({
            hasSelection: true,
            selectionStart,
            selectionEnd,
            isModifying: false,
          });
        }
        return;
      }

      if (
        isRangeSelecting ||
        Math.abs(event.pageX - mouseDownX) >= minSelectionStartWidth
      ) {
        isRangeSelecting = true;
        const { selectionStart, selectionEnd } = getSelectionFromEvent(event);
        this.props.updatePreviewSelection({
          hasSelection: true,
          selectionStart,
          selectionEnd,
          isModifying: true,
        });
      }
    };

    const pointerEndHandler = (event: PointerEvent) => {
      if (!event.isPrimary) {
        return;
      }
      if (isRangeSelecting) {
        // This click ends the current selection gesture.
        const { selectionStart, selectionEnd } = getSelectionFromEvent(event);
        this.props.updatePreviewSelection({
          hasSelection: true,
          selectionStart,
          selectionEnd,
          isModifying: false,
        });
        // Stop propagation so that no thread and no call node is selected when
        // creating a preview selection.
        event.stopPropagation();
        this._uninstallMoveAndClickHandlers();
        return;
      }

      // This is a normal click where no selection is currently occurring (but
      // there may be one from a previous selection operation).

      const { previewSelection } = this.props;
      if (previewSelection.hasSelection) {
        // There's a selection.
        // Dismiss it but only if the click is outside the current selection.
        const clickTime =
          ((event.pageX - rect.left) / rect.width) *
            (committedRange.end - committedRange.start) +
          committedRange.start;
        const { selectionStart, selectionEnd } = previewSelection;
        if (clickTime < selectionStart || clickTime >= selectionEnd) {
          // Stop propagation so that no thread and no call node is selected
          // when removing the preview selections.
          event.stopPropagation();

          // Unset preview selection.
          this.props.updatePreviewSelection({
            hasSelection: false,
            isModifying: false,
          });
        }
      }

      // Do not stopPropagation(), so that underlying graphs get the click event.
      // In all cases, remove the event handlers.
      this._uninstallMoveAndClickHandlers();
    };

    this._installMoveAndClickHandlers(
      pointerEndHandler,
      pointerMoveHandler,
      pointerEndHandler
    );
  };

  _installMoveAndClickHandlers(
    pointerStartHandler: PointerHandler,
    pointerMoveHandler: PointerHandler,
    pointerEndHandler: PointerHandler
  ) {
    // Unregister any leftover old handlers, in case we didn't get a click for the previous
    // drag (e.g. when tab switching during a drag, or when ctrl+clicking on macOS).
    this._uninstallMoveAndClickHandlers();

    this._handlers = { pointerStartHandler, pointerMoveHandler, pointerEndHandler };
    window.addEventListener('pointerdown', pointerStartHandler, true);
    window.addEventListener('pointermove', pointerMoveHandler, true);
    window.addEventListener('pointerup', pointerEndHandler, true);
  }

  _uninstallMoveAndClickHandlers() {
    if (this._handlers) {
      const { pointerStartHandler, pointerMoveHandler, pointerEndHandler } =
        this._handlers;
      window.removeEventListener('pointerdown', pointerStartHandler, true);
      window.removeEventListener('pointermove', pointerMoveHandler, true);
      window.removeEventListener('pointerup', pointerEndHandler, true);
      this._handlers = null;
    }
  }

  _onPointerMove = (event: SyntheticPointerEvent<>) => {
    if (!event.isPrimary) {
      return; // this is not the primary pointer (e.g. the second finger on a touch device)
    }
    if (!this._container) {
      return;
    }

    const rect = getContentRect(this._container);
    if (
      event.pageX < rect.left ||
      event.pageX >= rect.right ||
      event.pageY < rect.top ||
      event.pageY >= rect.bottom
    ) {
      this.setState({ hoverLocation: null });
    } else {
      this.setState({ hoverLocation: event.pageX - rect.left });
    }
  };

  _makeOnMove =
    (fun: (number) => { startDelta: number, endDelta: number }) =>
    (
      originalSelection: { +selectionStart: number, +selectionEnd: number },
      dx: number,
      dy: number,
      isModifying: boolean
    ) => {
      const { committedRange, width, updatePreviewSelection } = this.props;
      const delta = (dx / width) * (committedRange.end - committedRange.start);
      const selectionDeltas = fun(delta);
      const selectionStart = Math.max(
        committedRange.start,
        originalSelection.selectionStart + selectionDeltas.startDelta
      );
      const selectionEnd = clamp(
        originalSelection.selectionEnd + selectionDeltas.endDelta,
        selectionStart,
        committedRange.end
      );
      updatePreviewSelection({
        hasSelection: true,
        isModifying,
        selectionStart,
        selectionEnd,
      });
    };

  _rangeStartOnMove = this._makeOnMove((delta) => ({
    startDelta: delta,
    endDelta: 0,
  }));

  _moveRangeOnMove = this._makeOnMove((delta) => ({
    startDelta: delta,
    endDelta: delta,
  }));

  _rangeEndOnMove = this._makeOnMove((delta) => ({
    startDelta: 0,
    endDelta: delta,
  }));

  _zoomButtonOnPointerDown = (e: SyntheticPointerEvent<>) => {
    e.stopPropagation();
  };

  _zoomButtonOnClick = (e: SyntheticPointerEvent<>) => {
    e.stopPropagation();
    const { previewSelection, zeroAt, commitRange } = this.props;
    if (previewSelection.hasSelection) {
      commitRange(
        previewSelection.selectionStart - zeroAt,
        previewSelection.selectionEnd - zeroAt
      );
    }
  };

  renderSelectionOverlay(previewSelection: {
    +selectionStart: number,
    +selectionEnd: number,
    +isModifying: boolean,
  }) {
    const { committedRange, width } = this.props;
    const { selectionStart, selectionEnd } = previewSelection;

    const beforeWidth =
      ((selectionStart - committedRange.start) /
        (committedRange.end - committedRange.start)) *
      width;
    const selectionWidth =
      ((selectionEnd - selectionStart) /
        (committedRange.end - committedRange.start)) *
      width;

    return (
      <div className="timelineSelectionOverlay">
        <div
          className="timelineSelectionDimmerBefore"
          style={{ width: `${beforeWidth}px` }}
        />
        <div className="timelineSelectionOverlayWrapper">
          <div
            className="timelineSelectionGrippy"
            style={{ width: `${selectionWidth}px` }}
          >
            <Draggable
              className="timelineSelectionGrippyRangeStart"
              value={previewSelection}
              onMove={this._rangeStartOnMove}
            />
            <Draggable
              className="timelineSelectionGrippyMoveRange"
              value={previewSelection}
              onMove={this._moveRangeOnMove}
            />
            <Draggable
              className="timelineSelectionGrippyRangeEnd"
              value={previewSelection}
              onMove={this._rangeEndOnMove}
            />
          </div>
          <div className="timelineSelectionOverlayInner">
            <span
              className={classNames('timelineSelectionOverlayRange', {
                hidden: !previewSelection.isModifying,
              })}
            >
              {getFormattedTimeLength(selectionEnd - selectionStart)}
            </span>
            <button
              className={classNames('timelineSelectionOverlayZoomButton', {
                hidden: previewSelection.isModifying,
              })}
              type="button"
              onPointerDown={this._zoomButtonOnPointerDown}
              onClick={this._zoomButtonOnClick}
            />
          </div>
        </div>
        <div className="timelineSelectionDimmerAfter" />
      </div>
    );
  }

  render() {
    const { children, previewSelection, className } = this.props;
    const { hoverLocation } = this.state;

    return (
      <div
        className={classNames('timelineSelection', className)}
        ref={this._containerCreated}
        onPointerDown={this._onPointerDown}
        onPointerMove={this._onPointerMove}
      >
        {children}
        {previewSelection.hasSelection
          ? this.renderSelectionOverlay(previewSelection)
          : null}
        <div
          className="timelineSelectionHoverLine"
          style={{
            visibility:
              previewSelection.isModifying || hoverLocation === null
                ? 'hidden'
                : undefined,
            left: hoverLocation === null ? '0' : `${hoverLocation}px`,
          }}
        />
      </div>
    );
  }
}

export const TimelineSelection = explicitConnect<
  OwnProps,
  StateProps,
  DispatchProps
>({
  mapStateToProps: (state) => ({
    previewSelection: getPreviewSelection(state),
    committedRange: getCommittedRange(state),
    zeroAt: getZeroAt(state),
  }),
  mapDispatchToProps: {
    updatePreviewSelection,
    commitRange,
  },
  component: TimelineRulerAndSelection,
});
