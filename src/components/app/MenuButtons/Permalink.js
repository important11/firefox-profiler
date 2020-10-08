/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import { ButtonWithPanel } from 'firefox-profiler/components/shared/ButtonWithPanel';
import * as UrlUtils from 'firefox-profiler/utils/shorten-url';

import './Permalink.css';

type Props = {|
  +isNewlyPublished: boolean,
  // This is for injecting a URL shortener for tests. Normally we would use a Jest mock
  // that would mock out a local module, but I was having trouble getting it working
  // correctly (perhaps due to ES6 modules), so I just went with dependency injection
  // instead.
  +injectedUrlShortener?: typeof UrlUtils.shortenUrl | void,
|};

type State = {|
  fullUrl: string,
  shortUrl: string,
|};

export class MenuButtonsPermalink extends React.PureComponent<Props, State> {
  _permalinkButton: ButtonWithPanel | null;
  _permalinkTextField: HTMLInputElement | null;
  _takePermalinkButtonRef = (elem: ButtonWithPanel | null) => {
    this._permalinkButton = elem;
  };
  _takePermalinkTextFieldRef = (elem: HTMLInputElement | null) => {
    this._permalinkTextField = elem;
  };

  state = {
    fullUrl: '',
    shortUrl: '',
  };

  _shortenUrlAndFocusTextFieldOnCompletion = async (): Promise<void> => {
    const { fullUrl } = this.state;
    const currentFullUrl = window.location.href;
    if (fullUrl !== currentFullUrl) {
      const shortenUrl = this.props.injectedUrlShortener || UrlUtils.shortenUrl;
      try {
        const shortUrl = await shortenUrl(currentFullUrl);
        this.setState({ shortUrl, fullUrl: currentFullUrl });
      } catch (error) {
        console.warn('Unable to shorten the URL.', error);
        // Don't remember the fullUrl so that we will attempt to shorten the
        // URL again.
        this.setState({ shortUrl: currentFullUrl, fullUrl: '' });
      }
    }

    const textField = this._permalinkTextField;
    if (textField) {
      textField.focus();
      textField.select();
    }
  };

  _onPermalinkPanelClose = () => {
    if (this._permalinkTextField) {
      this._permalinkTextField.blur();
    }
  };

  render() {
    return (
      <ButtonWithPanel
        buttonClassName="menuButtonsButton menuButtonsButtonButton__hasIcon menuButtonsPermalinkButtonButton"
        ref={this._takePermalinkButtonRef}
        label="Permalink"
        initialOpen={this.props.isNewlyPublished}
        onPanelOpen={this._shortenUrlAndFocusTextFieldOnCompletion}
        onPanelClose={this._onPermalinkPanelClose}
        panelClassName="menuButtonsPermalinkPanel"
        panelContent={
          <input
            data-testid="MenuButtonsPermalink-input"
            type="text"
            className="menuButtonsPermalinkTextField photon-input"
            value={this.state.shortUrl}
            readOnly="readOnly"
            ref={this._takePermalinkTextFieldRef}
          />
        }
      />
    );
  }
}
